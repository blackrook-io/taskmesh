import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import type { MutationResult } from "../../lib/mutationResult.js";
import { optionalMarkdown, plainTitle } from "../../lib/markdownFields.js";
import { sanitizeMarkdown } from "../../lib/sanitizeMarkdown.js";
import {
  dueDateSchema,
  isDeletedTaskState,
  selectableTaskStateSchema,
  taskPrioritySchema,
} from "../../lib/taskFields.js";
import { LINK_RELATIONS } from "../../lib/entityLinkRules.js";
import { AI_READ_ENTITY_TYPES } from "./aiPolicy.js";
import { isRejectedDerivedProgress, resolveDerivedParent } from "../../lib/todoHierarchy.js";
import { resolveTodoProgressUpdate } from "../../lib/todoProgress.js";
import { allocateTodoListNumber, allocateTodoNumber } from "../entityNumbers.js";
import { entityExists, isTaggableEntityType } from "../entities.js";
import { recordTodoFieldChanges } from "../entityActivity.js";
import { createManualLink, EntityLinkError } from "../entityLinks.js";
import { syncMentionLinks } from "../mentionLinks.js";
import {
  assertCanAccessDualScoped,
  assertCanAccessEntity,
  assertCanAccessOwned,
  assertCanAccessProject,
  OwnershipAccessError,
} from "../ownership.js";
import { userHasAdministrator } from "../roles.js";
import { addDependency } from "../taskDependencies.js";
import { applyTaskGroupAutoTagsForTask } from "../taskGroupAutoTag.js";
import { assertTaskTagAdd, TaskWorkflowError } from "../taskWorkflow.js";
import { syncTodoMembershipChecked } from "../todoProgress.js";
import { loadRollup, recomputeAncestorChain } from "../todoHierarchy.js";

const readEntityType = z.enum(AI_READ_ENTITY_TYPES);

function fail(status: number, code: string, message: string): MutationResult {
  return { ok: false, status, code, message };
}

function fromError(err: unknown): MutationResult | null {
  if (err instanceof OwnershipAccessError) return fail(err.status, err.code, err.message);
  if (err instanceof TaskWorkflowError) return fail(err.status, err.code, err.message);
  if (err instanceof EntityLinkError) return fail(err.status, err.code, err.message);
  if (err instanceof z.ZodError) {
    return fail(400, "validation_error", err.issues[0]?.message ?? "Invalid proposal fields");
  }
  return null;
}

export async function applyTodoCreate(fields: Record<string, unknown>, actorId: number): Promise<MutationResult> {
  try {
    const parsed = z
      .object({
        title: plainTitle(2000),
        description: optionalMarkdown(50_000),
        dueDate: dueDateSchema,
        state: selectableTaskStateSchema.optional(),
        priority: taskPrioritySchema.optional(),
        progress: z.number().int().min(0).max(100).optional(),
        projectId: z.number().int().positive().nullable().optional(),
      })
      .parse(fields);
    const projectId = parsed.projectId ?? null;
    if (projectId != null) await assertCanAccessProject(db, actorId, projectId, "write");
    const number = await allocateTodoNumber(db);
    const initial = resolveTodoProgressUpdate(
      { progress: 0, state: "new" },
      {
        state: parsed.state ?? "new",
        ...(parsed.progress !== undefined ? { progress: parsed.progress } : {}),
      },
    );
    const [row] = await db
      .insert(schema.todos)
      .values({
        number,
        title: parsed.title,
        description: parsed.description ?? null,
        dueDate: parsed.dueDate ?? null,
        state: initial.state,
        progress: initial.progress,
        priority: parsed.priority ?? "none",
        projectId,
        sortOrder: 0,
        createdById: actorId,
        updatedById: actorId,
        ownerId: actorId,
      })
      .returning();
    if (!row) return fail(500, "insert_failed", "Could not create ToDo");
    await syncMentionLinks(db, {
      srcType: "todo",
      srcId: row.id,
      markdown: row.description,
      actorUserId: actorId,
    });
    if (initial.membershipChecked != null) {
      await syncTodoMembershipChecked(db, row.id, initial.membershipChecked);
    }
    return { ok: true, status: 201, data: row };
  } catch (err) {
    const known = fromError(err);
    if (known) return known;
    throw err;
  }
}

export async function applyTodoUpdate(
  todoId: number,
  fields: Record<string, unknown>,
  actorId: number,
): Promise<MutationResult> {
  try {
    const parsed = z
      .object({
        title: plainTitle(2000).optional(),
        description: optionalMarkdown(50_000),
        dueDate: dueDateSchema,
        state: selectableTaskStateSchema.optional(),
        priority: taskPrioritySchema.optional(),
        progress: z.number().int().min(0).max(100).optional(),
      })
      .parse(fields);
    const [existing] = await db.select().from(schema.todos).where(eq(schema.todos.id, todoId));
    if (!existing || isDeletedTaskState(existing.state)) {
      return fail(404, "not_found", "ToDo not found");
    }
    await assertCanAccessDualScoped(db, actorId, existing, "write");
    const rollup = await loadRollup(db, todoId);
    const touchesProgress = parsed.state !== undefined || parsed.progress !== undefined;
    if (
      touchesProgress &&
      parsed.progress !== undefined &&
      isRejectedDerivedProgress(
        { state: existing.state, progress: existing.progress },
        rollup,
        parsed.progress,
        parsed.state,
      )
    ) {
      return fail(400, "progress_derived", "Progress is calculated from sub-items");
    }
    const progressUpdate = !touchesProgress
      ? null
      : rollup.derived
        ? resolveDerivedParent(
            { state: existing.state, progress: existing.progress },
            rollup,
            {
              ...(parsed.state !== undefined ? { state: parsed.state } : {}),
              ...(parsed.progress !== undefined ? { progress: parsed.progress } : {}),
            },
          )
        : resolveTodoProgressUpdate(
            { progress: existing.progress, state: existing.state },
            {
              ...(parsed.progress !== undefined ? { progress: parsed.progress } : {}),
              ...(parsed.state !== undefined ? { state: parsed.state } : {}),
            },
          );
    const [row] = await db
      .update(schema.todos)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(parsed.dueDate !== undefined ? { dueDate: parsed.dueDate } : {}),
        ...(progressUpdate ? { state: progressUpdate.state, progress: progressUpdate.progress } : {}),
        ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
        updatedById: actorId,
        updatedAt: new Date(),
      })
      .where(eq(schema.todos.id, todoId))
      .returning();
    if (!row) return fail(500, "update_failed", "Could not update ToDo");
    if (progressUpdate?.membershipChecked != null) {
      await syncTodoMembershipChecked(db, todoId, progressUpdate.membershipChecked);
    }
    if (progressUpdate) {
      await recordTodoFieldChanges(
        db,
        todoId,
        { state: existing.state, progress: existing.progress },
        { state: progressUpdate.state, progress: progressUpdate.progress },
        actorId,
        "ai",
      );
      await recomputeAncestorChain(db, existing.parentId, actorId, "ai");
    }
    if (parsed.description !== undefined) {
      await syncMentionLinks(db, {
        srcType: "todo",
        srcId: row.id,
        markdown: row.description,
        actorUserId: actorId,
      });
    }
    return { ok: true, status: 200, data: row };
  } catch (err) {
    const known = fromError(err);
    if (known) return known;
    throw err;
  }
}

export async function applyTodoListCreate(
  fields: Record<string, unknown>,
  actorId: number,
): Promise<MutationResult> {
  try {
    const parsed = z
      .object({
        title: plainTitle(500),
        projectId: z.number().int().positive().nullable().optional(),
      })
      .parse(fields);
    const projectId = parsed.projectId ?? null;
    if (projectId != null) await assertCanAccessProject(db, actorId, projectId, "write");
    const number = await allocateTodoListNumber(db);
    const [row] = await db
      .insert(schema.todoLists)
      .values({
        number,
        title: parsed.title,
        projectId,
        kind: "list",
        ownerId: actorId,
      })
      .returning();
    if (!row) return fail(500, "insert_failed", "Could not create list");
    return { ok: true, status: 201, data: row };
  } catch (err) {
    const known = fromError(err);
    if (known) return known;
    throw err;
  }
}

export async function applyTodoListUpdate(
  listId: number,
  fields: Record<string, unknown>,
  actorId: number,
): Promise<MutationResult> {
  try {
    const parsed = z.object({ title: plainTitle(500) }).parse(fields);
    const [existing] = await db.select().from(schema.todoLists).where(eq(schema.todoLists.id, listId));
    if (!existing) return fail(404, "not_found", "List not found");
    await assertCanAccessDualScoped(db, actorId, existing, "write");
    const [row] = await db
      .update(schema.todoLists)
      .set({ title: parsed.title, updatedAt: new Date() })
      .where(eq(schema.todoLists.id, listId))
      .returning();
    if (!row) return fail(500, "update_failed", "Could not update list");
    return { ok: true, status: 200, data: row };
  } catch (err) {
    const known = fromError(err);
    if (known) return known;
    throw err;
  }
}

export async function applyManualLink(
  fields: Record<string, unknown>,
  actorId: number,
): Promise<MutationResult> {
  try {
    const parsed = z
      .object({
        srcType: readEntityType,
        srcId: z.number().int().positive(),
        dstType: readEntityType,
        dstId: z.number().int().positive(),
        relation: z.enum(LINK_RELATIONS).optional(),
      })
      .parse(fields);
    await assertCanAccessEntity(db, actorId, parsed.srcType, parsed.srcId, "write");
    await assertCanAccessEntity(db, actorId, parsed.dstType, parsed.dstId);
    const result = await createManualLink(
      db,
      { ...parsed, createdById: actorId },
      { userId: actorId, isAdministrator: await userHasAdministrator(db, actorId) },
    );
    return { ok: true, status: result.created ? 201 : 200, data: result.link };
  } catch (err) {
    const known = fromError(err);
    if (known) return known;
    throw err;
  }
}

export async function applyTagAdd(
  fields: Record<string, unknown>,
  actorId: number,
  entityType: string,
  entityId: number,
): Promise<MutationResult> {
  try {
    const parsed = z.object({ name: plainTitle(100) }).parse(fields);
    if (!isTaggableEntityType(entityType)) {
      return fail(400, "validation_error", `Entity type ${entityType} does not support tags`);
    }
    const exists = await entityExists(db, entityType, entityId);
    if (!exists) return fail(404, "not_found", "Entity not found");
    await assertCanAccessEntity(db, actorId, entityType, entityId, "write");
    const [existing] = await db
      .select()
      .from(schema.tags)
      .where(and(eq(schema.tags.ownerId, actorId), eq(schema.tags.name, parsed.name)));
    const tag =
      existing ??
      (
        await db
          .insert(schema.tags)
          .values({ name: parsed.name, ownerId: actorId })
          .returning()
      )[0];
    if (!tag) return fail(500, "insert_failed", "Could not resolve tag");
    if (existing) await assertCanAccessOwned(db, actorId, existing.ownerId);
    const [dup] = await db
      .select({ id: schema.taggings.id })
      .from(schema.taggings)
      .where(
        and(
          eq(schema.taggings.tagId, tag.id),
          eq(schema.taggings.entityType, entityType),
          eq(schema.taggings.entityId, entityId),
        ),
      );
    if (dup) return { ok: true, status: 200, data: { id: tag.id, name: tag.name, created: false } };
    if (entityType === "task") {
      const [task] = await db
        .select({ state: schema.tasks.state })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, entityId));
      if (!task) return fail(404, "not_found", "Task not found");
      const existingTags = await db
        .select({ id: schema.taggings.id })
        .from(schema.taggings)
        .where(and(eq(schema.taggings.entityType, "task"), eq(schema.taggings.entityId, entityId)));
      assertTaskTagAdd(task.state, existingTags.length);
    }
    const [tagging] = await db
      .insert(schema.taggings)
      .values({ tagId: tag.id, entityType, entityId })
      .returning({ id: schema.taggings.id });
    if (!tagging) return fail(500, "insert_failed", "Could not add tag");
    if (entityType === "task") await applyTaskGroupAutoTagsForTask(db, entityId);
    return {
      ok: true,
      status: 201,
      data: { id: tag.id, name: tag.name, taggingId: tagging.id, created: true },
    };
  } catch (err) {
    const known = fromError(err);
    if (known) return known;
    throw err;
  }
}

export async function applyComment(
  entityType: "task" | "todo" | "todo_list",
  entityId: number,
  fields: Record<string, unknown>,
  actorId: number,
): Promise<MutationResult> {
  try {
    const parsed = z
      .object({
        body: z
          .string()
          .min(1)
          .max(50_000)
          .transform(sanitizeMarkdown)
          .refine((value) => value.trim().length > 0, { message: "body must not be empty" }),
      })
      .parse(fields);
    await assertCanAccessEntity(db, actorId, entityType, entityId, "write");
    const [row] = await db
      .insert(schema.taskActivity)
      .values({
        taskId: entityType === "task" ? entityId : null,
        entityType,
        entityId,
        kind: "comment",
        body: parsed.body,
        createdById: actorId,
        source: "ai",
      })
      .returning({ id: schema.taskActivity.id, body: schema.taskActivity.body });
    if (!row) return fail(500, "insert_failed", "Could not create comment");
    return { ok: true, status: 201, data: row };
  } catch (err) {
    const known = fromError(err);
    if (known) return known;
    throw err;
  }
}

export async function applyTaskDependency(
  taskId: number,
  fields: Record<string, unknown>,
  actorId: number,
): Promise<MutationResult> {
  try {
    const parsed = z.object({ dependsOnTaskId: z.number().int().positive() }).parse(fields);
    await assertCanAccessEntity(db, actorId, "task", taskId, "write");
    await assertCanAccessEntity(db, actorId, "task", parsed.dependsOnTaskId, "write");
    const result = await addDependency(db, taskId, parsed.dependsOnTaskId, {
      actorId,
      source: "ai",
    });
    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : 400;
      return fail(status, result.code, result.message);
    }
    return {
      ok: true,
      status: result.created ? 201 : 200,
      data: {
        created: result.created,
        dependsOnTaskId: parsed.dependsOnTaskId,
        dependsOn: result.dependsOn,
        requiredBy: result.requiredBy,
      },
    };
  } catch (err) {
    const known = fromError(err);
    if (known) return known;
    throw err;
  }
}
