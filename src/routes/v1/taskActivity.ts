import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { activitySourceFromRequest } from "../../lib/activityRequest.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { sanitizeMarkdown } from "../../lib/sanitizeMarkdown.js";
import { dueDateSchema } from "../../lib/taskFields.js";
import { recordTaskChanges, type TaskLike } from "../../services/tasks.js";
import { assertCanAccessDualScoped } from "../../services/ownership.js";
import { getCurrentUserId, loadUserMap } from "../../services/users.js";

const idParam = z.coerce.number().int().positive();

const commentBody = z.object({
  body: z
    .string()
    .min(1)
    .max(50_000)
    .transform(sanitizeMarkdown)
    .refine((s) => s.trim().length > 0, { message: "body must not be empty" }),
});

const sessionBody = z.object({
  before: z.object({
    title: z.string(),
    description: z.string().nullable(),
    state: z.string(),
    priority: z.string(),
    dueDate: dueDateSchema,
    color: z.string().nullable(),
    phaseId: z.number().int().positive().nullable(),
    parentId: z.number().int().positive().nullable(),
    projectId: z.number().int().positive().nullable(),
  }),
});

async function serializeActivityRows(rows: (typeof schema.taskActivity.$inferSelect)[]) {
  const byId = await loadUserMap(db);
  return rows.map((row) => ({
    ...row,
    createdBy: row.createdById != null ? (byId.get(row.createdById) ?? null) : null,
  }));
}

/** Task history timeline: comments (editable) + auto-recorded field changes. */
export const taskActivityRouter = Router();

taskActivityRouter.get("/:taskId/activity", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!task) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessDualScoped(db, actorId, task);
    const rows = await db
      .select()
      .from(schema.taskActivity)
      .where(eq(schema.taskActivity.taskId, taskId))
      .orderBy(asc(schema.taskActivity.createdAt), asc(schema.taskActivity.id));
    res.json({ data: await serializeActivityRows(rows) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

/**
 * Record one History summary for a modal edit session: diff `before` (snapshot
 * when the editor opened) against the current task row.
 */
taskActivityRouter.post("/:taskId/activity/session", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const parsed = sessionBody.parse(req.body);
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!task) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessDualScoped(db, actorId, task);
    const before: TaskLike = {
      title: parsed.before.title,
      description: parsed.before.description,
      state: parsed.before.state,
      priority: parsed.before.priority,
      dueDate: parsed.before.dueDate ?? null,
      color: parsed.before.color,
      phaseId: parsed.before.phaseId,
      parentId: parsed.before.parentId,
      projectId: parsed.before.projectId,
    };
    const after: TaskLike = {
      title: task.title,
      description: task.description,
      state: task.state,
      priority: task.priority,
      dueDate: task.dueDate,
      color: task.color,
      phaseId: task.phaseId,
      parentId: task.parentId,
      projectId: task.projectId,
    };
    const row = await recordTaskChanges(db, taskId, before, after, {
      actorId,
      source: activitySourceFromRequest(req),
    });
    if (!row) {
      res.status(204).end();
      return;
    }
    const [serialized] = await serializeActivityRows([row]);
    res.status(201).json({ data: serialized });
  } catch (err) {
    handleRouteError(res, err);
  }
});

taskActivityRouter.post("/:taskId/activity", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!task) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessDualScoped(db, actorId, task);
    const parsed = commentBody.parse(req.body);
    const [row] = await db
      .insert(schema.taskActivity)
      .values({
        taskId,
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

taskActivityRouter.patch("/:taskId/activity/:entryId", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const entryId = idParam.parse(req.params.entryId);
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!task) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessDualScoped(db, actorId, task);
    const parsed = commentBody.parse(req.body);
    const [existing] = await db
      .select()
      .from(schema.taskActivity)
      .where(eq(schema.taskActivity.id, entryId));
    if (!existing || existing.taskId !== taskId) {
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
