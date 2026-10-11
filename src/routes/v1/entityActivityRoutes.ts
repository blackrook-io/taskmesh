import { and, asc, eq } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { activitySourceFromRequest } from "../../lib/activityRequest.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { NotFoundError } from "../../lib/notFound.js";
import { sanitizeMarkdown } from "../../lib/sanitizeMarkdown.js";
import { NOT_ADMINISTRATOR_MESSAGE } from "../../middleware/requireAdministrator.js";
import { assertCanAccessDualScoped, type ProjectAccessLevel } from "../../services/ownership.js";
import { userHasAdministrator } from "../../services/roles.js";
import { getCurrentUserId, loadUserMap } from "../../services/users.js";

export type CommentEntityType = "task" | "todo" | "todo_list";

const positiveId = z.coerce.number().int().positive();

const commentBody = z.object({
  body: z
    .string()
    .min(1)
    .max(50_000)
    .transform(sanitizeMarkdown)
    .refine((s) => s.trim().length > 0, { message: "body must not be empty" }),
});

const MISSING: Record<CommentEntityType, string> = {
  task: "Task not found",
  todo: "ToDo not found",
  todo_list: "List not found",
};

export async function serializeActivityRows(rows: (typeof schema.taskActivity.$inferSelect)[]) {
  const byId = await loadUserMap(db);
  return rows.map((row) => ({
    ...row,
    createdBy: row.createdById != null ? (byId.get(row.createdById) ?? null) : null,
  }));
}

async function assertRecordAccess(
  entityType: CommentEntityType,
  entityId: number,
  actorId: number,
  level: ProjectAccessLevel,
): Promise<void> {
  if (entityType === "task") {
    const [row] = await db
      .select({ projectId: schema.tasks.projectId, ownerId: schema.tasks.ownerId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, entityId));
    if (!row) throw new NotFoundError(MISSING.task);
    await assertCanAccessDualScoped(db, actorId, row, level);
    return;
  }
  if (entityType === "todo") {
    const [row] = await db
      .select({ projectId: schema.todos.projectId, ownerId: schema.todos.ownerId })
      .from(schema.todos)
      .where(eq(schema.todos.id, entityId));
    if (!row) throw new NotFoundError(MISSING.todo);
    await assertCanAccessDualScoped(db, actorId, row, level);
    return;
  }
  const [row] = await db
    .select({ projectId: schema.todoLists.projectId, ownerId: schema.todoLists.ownerId })
    .from(schema.todoLists)
    .where(eq(schema.todoLists.id, entityId));
  if (!row) throw new NotFoundError(MISSING.todo_list);
  await assertCanAccessDualScoped(db, actorId, row, level);
}

function readEntityId(req: Request, paramName: string): number {
  return positiveId.parse(req.params[paramName]);
}

/**
 * Comment thread on an existing record router.
 * Paths are `/:param/activity` and `/:param/activity/:entryId`.
 */
export function registerCommentRoutes(
  router: Router,
  entityType: CommentEntityType,
  paramName: "taskId" | "id",
): void {
  router.get(`/:${paramName}/activity`, async (req, res) => {
    try {
      const entityId = readEntityId(req, paramName);
      const actorId = await getCurrentUserId(db);
      await assertRecordAccess(entityType, entityId, actorId, "read");
      const rows = await db
        .select()
        .from(schema.taskActivity)
        .where(
          and(
            eq(schema.taskActivity.entityType, entityType),
            eq(schema.taskActivity.entityId, entityId),
          ),
        )
        .orderBy(asc(schema.taskActivity.createdAt), asc(schema.taskActivity.id));
      res.json({ data: await serializeActivityRows(rows) });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.post(`/:${paramName}/activity`, async (req, res) => {
    try {
      const entityId = readEntityId(req, paramName);
      const actorId = await getCurrentUserId(db);
      await assertRecordAccess(entityType, entityId, actorId, "write");
      const parsed = commentBody.parse(req.body);
      const [row] = await db
        .insert(schema.taskActivity)
        .values({
          taskId: entityType === "task" ? entityId : null,
          entityType,
          entityId,
          kind: "comment",
          body: parsed.body,
          createdById: actorId,
          source: activitySourceFromRequest(req),
        })
        .returning();
      if (!row) {
        sendError(res, 500, "insert_failed", "Could not create comment");
        return;
      }
      const [serialized] = await serializeActivityRows([row]);
      res.status(201).json({ data: serialized });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.patch(`/:${paramName}/activity/:entryId`, async (req, res) => {
    try {
      const entityId = readEntityId(req, paramName);
      const entryId = positiveId.parse(req.params.entryId);
      const actorId = await getCurrentUserId(db);
      await assertRecordAccess(entityType, entityId, actorId, "write");
      const parsed = commentBody.parse(req.body);
      const [existing] = await db
        .select()
        .from(schema.taskActivity)
        .where(eq(schema.taskActivity.id, entryId));
      if (!existing || existing.entityType !== entityType || existing.entityId !== entityId) {
        sendError(res, 404, "not_found", "History entry not found");
        return;
      }
      if (existing.kind !== "comment") {
        sendError(res, 400, "not_editable", "Only comments can be edited");
        return;
      }
      const [row] = await db
        .update(schema.taskActivity)
        .set({ body: parsed.body, editedAt: new Date() })
        .where(eq(schema.taskActivity.id, entryId))
        .returning();
      if (!row) {
        sendError(res, 500, "update_failed", "Could not update comment");
        return;
      }
      const [serialized] = await serializeActivityRows([row]);
      res.json({ data: serialized });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  router.delete(`/:${paramName}/activity/:entryId`, async (req, res) => {
    try {
      const entityId = readEntityId(req, paramName);
      const entryId = positiveId.parse(req.params.entryId);
      const actorId = await getCurrentUserId(db);
      await assertRecordAccess(entityType, entityId, actorId, "read");
      if (!(await userHasAdministrator(db, actorId))) {
        sendError(res, 403, "not_administrator", NOT_ADMINISTRATOR_MESSAGE);
        return;
      }
      const [existing] = await db
        .select()
        .from(schema.taskActivity)
        .where(eq(schema.taskActivity.id, entryId));
      if (!existing || existing.entityType !== entityType || existing.entityId !== entityId) {
        sendError(res, 404, "not_found", "History entry not found");
        return;
      }
      if (existing.kind !== "comment") {
        sendError(res, 400, "not_deletable", "Only comments can be deleted");
        return;
      }
      await db.delete(schema.taskActivity).where(eq(schema.taskActivity.id, entryId));
      res.status(204).end();
    } catch (err) {
      handleRouteError(res, err);
    }
  });
}
