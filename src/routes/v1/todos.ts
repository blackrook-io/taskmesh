import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { optionalMarkdown, optionalPlainTitle, plainTitle } from "../../lib/markdownFields.js";
import {
  dueDateSchema,
  isDeletedTaskState,
  selectableTaskStateSchema,
  taskPrioritySchema,
  taskStateSchema,
} from "../../lib/taskFields.js";
import { allocateTodoNumber } from "../../services/entityNumbers.js";
import {
  assertCanAccessDualScoped,
  assertCanAccessOwned,
  assertCanAccessProject,
  dualScopeListFilter,
  ownerScope,
} from "../../services/ownership.js";
import { userHasAdministrator } from "../../services/roles.js";
import { allocateTaskNumber } from "../../services/tasks.js";
import { copyTaggings } from "../../services/copyTaggings.js";
import { getCurrentUserId, attachAssignees, attachAssignee, attachTaskActor } from "../../services/users.js";
import { resolveAssigneeId } from "../../services/assignees.js";
import { resolveTodoProgressUpdate } from "../../lib/todoProgress.js";
import {
  isRejectedDerivedProgress,
  resolveDerivedParent,
} from "../../lib/todoHierarchy.js";
import { syncTodoMembershipChecked } from "../../services/todoProgress.js";
import {
  assertTodoParent,
  hierarchyByTodoId,
  listChildSummaries,
  loadRollup,
  recomputeAncestorChain,
  type TodoHierarchyFields,
} from "../../services/todoHierarchy.js";

const idParam = z.coerce.number().int().positive();

const actionBySchema = z
  .union([z.string().datetime(), z.null()])
  .optional();

const createBody = z.object({
  title: plainTitle(2000),
  description: optionalMarkdown(50_000),
  dueDate: dueDateSchema,
  actionBy: actionBySchema,
  color: z.string().max(64).optional().nullable(),
  state: selectableTaskStateSchema.optional(),
  priority: taskPrioritySchema.optional(),
  projectId: z.number().int().positive().optional().nullable(),
  sourceIdeaId: z.number().int().positive().optional().nullable(),
  assigneeId: z.number().int().positive().nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  parentId: z.number().int().positive().optional().nullable(),
});

const patchBody = z.object({
  title: optionalPlainTitle(2000),
  description: optionalMarkdown(50_000),
  dueDate: dueDateSchema,
  actionBy: actionBySchema,
  color: z.string().max(64).optional().nullable(),
  state: selectableTaskStateSchema.optional(),
  priority: taskPrioritySchema.optional(),
  projectId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  parentId: z.number().int().positive().nullable().optional(),
});

const listQuery = z.object({
  projectId: z
    .union([z.literal("null"), z.coerce.number().int().positive()])
    .optional(),
  state: taskStateSchema.optional(),
  includeDeleted: z
    .union([z.literal("true"), z.literal("1"), z.literal("false"), z.literal("0")])
    .optional(),
});

const convertToTaskBody = z.object({
  projectId: z.number().int().positive().optional().nullable(),
  title: optionalPlainTitle(2000),
});

function parseActionBy(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}

async function withHierarchy<T extends { id: number }>(
  rows: T[],
): Promise<(T & TodoHierarchyFields)[]> {
  const fields = await hierarchyByTodoId(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    ...row,
    ...(fields.get(row.id) ?? { progressDerived: false, completeCount: 0, childCount: 0 }),
  }));
}

async function presentTodo<T extends { id: number }>(row: T, withChildren: boolean) {
  const [decorated] = await withHierarchy([row]);
  if (!withChildren) return decorated;
  const children = await listChildSummaries(db, row.id);
  return { ...decorated, children };
}

export const todosRouter = Router();

todosRouter.get("/", async (req, res) => {
  try {
    const parsed = listQuery.parse({
      projectId: req.query.projectId as string | undefined,
      state: req.query.state as string | undefined,
      includeDeleted: req.query.includeDeleted as string | undefined,
    });
    const actorId = await getCurrentUserId(db);
    const isAdmin = await userHasAdministrator(db, actorId);
    const filters = [];
    if (parsed.projectId === "null") {
      filters.push(isNull(schema.todos.projectId));
      const os = ownerScope(schema.todos.ownerId, actorId, isAdmin);
      if (os) filters.push(os);
    } else if (typeof parsed.projectId === "number") {
      await assertCanAccessProject(db, actorId, parsed.projectId);
      filters.push(eq(schema.todos.projectId, parsed.projectId));
    } else {
      const scope = dualScopeListFilter(
        db,
        schema.todos.projectId,
        schema.todos.ownerId,
        actorId,
        isAdmin,
      );
      if (scope) filters.push(scope);
    }
    if (parsed.state) {
      filters.push(eq(schema.todos.state, parsed.state));
    } else {
      const includeDeleted =
        parsed.includeDeleted === "true" || parsed.includeDeleted === "1";
      if (!includeDeleted) {
        filters.push(ne(schema.todos.state, "deleted"));
      }
    }
    const rows = await db
      .select()
      .from(schema.todos)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(schema.todos.updatedAt), desc(schema.todos.id));
    res.json({ data: await withHierarchy(await attachAssignees(db, rows)) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todosRouter.post("/", async (req, res) => {
  try {
    const parsed = createBody.parse(req.body);
    const actorId = await getCurrentUserId(db);
    if (parsed.projectId != null) {
      await assertCanAccessProject(db, actorId, parsed.projectId, "write");
    }
    if (parsed.sourceIdeaId != null) {
      const [idea] = await db
        .select({ id: schema.ideas.id, ownerId: schema.ideas.ownerId })
        .from(schema.ideas)
        .where(eq(schema.ideas.id, parsed.sourceIdeaId));
      if (!idea) {
        sendError(res, 404, "not_found", "Idea not found");
        return;
      }
      await assertCanAccessOwned(db, actorId, idea.ownerId);
    }
    const number = await allocateTodoNumber(db);
    const projectId = parsed.projectId ?? null;
    const parentId = parsed.parentId ?? null;
    const parentOk = await assertTodoParent(db, null, projectId, parentId);
    if (!parentOk.ok) {
      sendError(res, 400, "invalid_parent", parentOk.message);
      return;
    }
    if (parentId != null) {
      const [parent] = await db.select().from(schema.todos).where(eq(schema.todos.id, parentId));
      if (parent) await assertCanAccessDualScoped(db, actorId, parent, "write");
    }
    const assigneeId = await resolveAssigneeId(db, {
      projectId,
      requested: parsed.assigneeId,
      creating: true,
    });
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
        actionBy: parseActionBy(parsed.actionBy) ?? null,
        color: parsed.color ?? null,
        state: initial.state,
        progress: initial.progress,
        priority: parsed.priority ?? "none",
        projectId,
        sourceIdeaId: parsed.sourceIdeaId ?? null,
        parentId,
        sortOrder: 0,
        createdById: actorId,
        updatedById: actorId,
        ownerId: actorId,
        assigneeId,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create ToDo");
      return;
    }
    if (initial.membershipChecked != null) {
      await syncTodoMembershipChecked(db, row.id, initial.membershipChecked);
    }
    if (parentId != null) {
      await recomputeAncestorChain(db, parentId, actorId);
    }
    res.status(201).json({ data: await presentTodo(await attachAssignee(db, row), false) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todosRouter.get("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const [row] = await db.select().from(schema.todos).where(eq(schema.todos.id, id));
    if (!row) {
      sendError(res, 404, "not_found", "ToDo not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessDualScoped(db, actorId, row);
    res.json({ data: await presentTodo(await attachAssignee(db, row), true) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todosRouter.patch("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const parsed = patchBody.parse(req.body);
    if (
      !hasDefinedKeys(parsed, [
        "title",
        "description",
        "dueDate",
        "actionBy",
        "color",
        "state",
        "priority",
        "projectId",
        "assigneeId",
        "progress",
        "parentId",
      ])
    ) {
      sendError(res, 400, "empty_patch", "Provide at least one field to update");
      return;
    }
    const [existing] = await db.select().from(schema.todos).where(eq(schema.todos.id, id));
    if (!existing) {
      sendError(res, 404, "not_found", "ToDo not found");
      return;
    }
    if (isDeletedTaskState(existing.state)) {
      sendError(res, 400, "todo_deleted", "Cannot update a deleted ToDo");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessDualScoped(db, actorId, existing, "write");
    if (parsed.projectId !== undefined && parsed.projectId != null) {
      await assertCanAccessProject(db, actorId, parsed.projectId, "write");
    }
    const nextProjectId =
      parsed.projectId !== undefined ? parsed.projectId : existing.projectId;
    const projectChanging =
      parsed.projectId !== undefined && parsed.projectId !== existing.projectId;
    const nextParentId = parsed.parentId !== undefined ? parsed.parentId : existing.parentId;
    if (projectChanging) {
      const rollup = await loadRollup(db, id);
      if (rollup.derived) {
        sendError(res, 400, "has_children", "Move or remove sub-items before changing project");
        return;
      }
    }
    if (parsed.parentId !== undefined || (projectChanging && nextParentId != null)) {
      const parentOk = await assertTodoParent(db, id, nextProjectId, nextParentId);
      if (!parentOk.ok) {
        sendError(res, 400, "invalid_parent", parentOk.message);
        return;
      }
      if (nextParentId != null) {
        const [parent] = await db.select().from(schema.todos).where(eq(schema.todos.id, nextParentId));
        if (parent) await assertCanAccessDualScoped(db, actorId, parent, "write");
      }
    }
    const nextAssigneeId = await resolveAssigneeId(db, {
      projectId: nextProjectId,
      requested: parsed.assigneeId,
      previousAssigneeId: existing.assigneeId,
      projectChanging,
    });
    const rollup = await loadRollup(db, id);
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
      sendError(res, 400, "progress_derived", "Progress is calculated from sub-items");
      return;
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
        ...(parsed.actionBy !== undefined
          ? { actionBy: parseActionBy(parsed.actionBy) ?? null }
          : {}),
        ...(parsed.color !== undefined ? { color: parsed.color } : {}),
        ...(progressUpdate
          ? { state: progressUpdate.state, progress: progressUpdate.progress }
          : {}),
        ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
        ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
        ...(parsed.parentId !== undefined ? { parentId: nextParentId } : {}),
        ...(parsed.assigneeId !== undefined || nextAssigneeId !== existing.assigneeId
          ? { assigneeId: nextAssigneeId }
          : {}),
        updatedById: actorId,
        updatedAt: new Date(),
      })
      .where(eq(schema.todos.id, id))
      .returning();
    if (progressUpdate?.membershipChecked != null) {
      await syncTodoMembershipChecked(db, id, progressUpdate.membershipChecked);
    }
    if (parsed.parentId !== undefined && nextParentId !== existing.parentId) {
      await recomputeAncestorChain(db, nextParentId, actorId);
      await recomputeAncestorChain(db, existing.parentId, actorId);
    } else if (progressUpdate) {
      await recomputeAncestorChain(db, existing.parentId, actorId);
    }
    res.json({ data: row ? await presentTodo(await attachAssignee(db, row), true) : row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todosRouter.delete("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const [existing] = await db.select().from(schema.todos).where(eq(schema.todos.id, id));
    if (!existing) {
      sendError(res, 404, "not_found", "ToDo not found");
      return;
    }
    if (isDeletedTaskState(existing.state)) {
      sendError(res, 400, "todo_deleted", "ToDo is already deleted");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessDualScoped(db, actorId, existing, "write");
    const [row] = await db
      .update(schema.todos)
      .set({
        state: "deleted",
        updatedById: actorId,
        updatedAt: new Date(),
      })
      .where(eq(schema.todos.id, id))
      .returning();
    await recomputeAncestorChain(db, existing.parentId, actorId);
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

/** Idea → ToDo (source Idea kept; tags copied; sourceIdeaId set). */
todosRouter.post("/from-idea/:ideaId", async (req, res) => {
  try {
    const ideaId = idParam.parse(req.params.ideaId);
    const body = z
      .object({
        projectId: z.number().int().positive().optional().nullable(),
        title: optionalPlainTitle(2000),
      })
      .parse(req.body ?? {});
    const [idea] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, ideaId));
    if (!idea) {
      sendError(res, 404, "not_found", "Idea not found");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessOwned(db, actorId, idea.ownerId);
    if (body.projectId != null) {
      await assertCanAccessProject(db, actorId, body.projectId, "write");
    }
    const number = await allocateTodoNumber(db);
    const projectId = body.projectId ?? null;
    const assigneeId = await resolveAssigneeId(db, {
      projectId,
      creating: true,
    });
    const [todo] = await db
      .insert(schema.todos)
      .values({
        number,
        title: body.title ?? idea.title,
        description: idea.body,
        projectId,
        sourceIdeaId: idea.id,
        state: "new",
        priority: "none",
        sortOrder: 0,
        createdById: actorId,
        updatedById: actorId,
        ownerId: actorId,
        assigneeId,
      })
      .returning();
    if (!todo) {
      sendError(res, 500, "insert_failed", "Could not create ToDo");
      return;
    }
    await copyTaggings(
      db,
      { entityType: "idea", entityId: idea.id },
      { entityType: "todo", entityId: todo.id },
    );
    res.status(201).json({ data: await attachAssignee(db, todo) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

/** ToDo → Task (source ToDo kept; tags copied). */
todosRouter.post("/:id/convert-to-task", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const parsed = convertToTaskBody.parse(req.body ?? {});
    const [todo] = await db.select().from(schema.todos).where(eq(schema.todos.id, id));
    if (!todo) {
      sendError(res, 404, "not_found", "ToDo not found");
      return;
    }
    if (isDeletedTaskState(todo.state)) {
      sendError(res, 400, "todo_deleted", "Cannot convert a deleted ToDo");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessDualScoped(db, actorId, todo, "write");
    const projectId =
      parsed.projectId !== undefined ? parsed.projectId : todo.projectId;
    if (projectId != null) {
      await assertCanAccessProject(db, actorId, projectId, "write");
    }
    const number = await allocateTaskNumber(db);
    let description = todo.description ?? "";
    if (todo.actionBy) {
      const note = `Action by: ${todo.actionBy.toISOString()}`;
      description = description ? `${description}\n\n${note}` : note;
    }
    const assigneeId = await resolveAssigneeId(db, {
      projectId: projectId ?? null,
      requested: todo.assigneeId != null ? todo.assigneeId : undefined,
      creating: true,
    });
    const [task] = await db
      .insert(schema.tasks)
      .values({
        projectId,
        number,
        title: parsed.title ?? todo.title,
        description: description || null,
        state: todo.state === "deleted" ? "new" : todo.state,
        priority: todo.priority,
        dueDate: todo.dueDate,
        color: todo.color,
        sortOrder: 0,
        createdById: actorId,
        updatedById: actorId,
        ownerId: actorId,
        assigneeId,
      })
      .returning();
    if (!task) {
      sendError(res, 500, "insert_failed", "Could not create task");
      return;
    }
    await copyTaggings(
      db,
      { entityType: "todo", entityId: todo.id },
      { entityType: "task", entityId: task.id },
    );
    res.status(201).json({ data: await attachTaskActor(db, task) });
  } catch (err) {
    handleRouteError(res, err);
  }
});
