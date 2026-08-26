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
import { allocateTaskNumber } from "../../services/tasks.js";
import { copyTaggings } from "../../services/copyTaggings.js";
import { getCurrentUserId } from "../../services/users.js";

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

export const todosRouter = Router();

todosRouter.get("/", async (req, res) => {
  try {
    const parsed = listQuery.parse({
      projectId: req.query.projectId as string | undefined,
      state: req.query.state as string | undefined,
      includeDeleted: req.query.includeDeleted as string | undefined,
    });
    const filters = [];
    if (parsed.projectId === "null") {
      filters.push(isNull(schema.todos.projectId));
    } else if (typeof parsed.projectId === "number") {
      filters.push(eq(schema.todos.projectId, parsed.projectId));
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
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

todosRouter.post("/", async (req, res) => {
  try {
    const parsed = createBody.parse(req.body);
    if (parsed.projectId != null) {
      const [proj] = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.id, parsed.projectId));
      if (!proj) {
        sendError(res, 404, "not_found", "Project not found");
        return;
      }
    }
    if (parsed.sourceIdeaId != null) {
      const [idea] = await db
        .select({ id: schema.ideas.id })
        .from(schema.ideas)
        .where(eq(schema.ideas.id, parsed.sourceIdeaId));
      if (!idea) {
        sendError(res, 404, "not_found", "Idea not found");
        return;
      }
    }
    const number = await allocateTodoNumber(db);
    const actorId = await getCurrentUserId(db);
    const [row] = await db
      .insert(schema.todos)
      .values({
        number,
        title: parsed.title,
        description: parsed.description ?? null,
        dueDate: parsed.dueDate ?? null,
        actionBy: parseActionBy(parsed.actionBy) ?? null,
        color: parsed.color ?? null,
        state: parsed.state ?? "new",
        priority: parsed.priority ?? "none",
        projectId: parsed.projectId ?? null,
        sourceIdeaId: parsed.sourceIdeaId ?? null,
        sortOrder: 0,
        createdById: actorId,
        updatedById: actorId,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create ToDo");
      return;
    }
    res.status(201).json({ data: row });
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
    res.json({ data: row });
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
    if (parsed.projectId !== undefined && parsed.projectId != null) {
      const [proj] = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.id, parsed.projectId));
      if (!proj) {
        sendError(res, 404, "not_found", "Project not found");
        return;
      }
    }
    const actorId = await getCurrentUserId(db);
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
        ...(parsed.state !== undefined ? { state: parsed.state } : {}),
        ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
        ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
        updatedById: actorId,
        updatedAt: new Date(),
      })
      .where(eq(schema.todos.id, id))
      .returning();
    res.json({ data: row });
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
    const [row] = await db
      .update(schema.todos)
      .set({
        state: "deleted",
        updatedById: actorId,
        updatedAt: new Date(),
      })
      .where(eq(schema.todos.id, id))
      .returning();
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
    if (body.projectId != null) {
      const [proj] = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.id, body.projectId));
      if (!proj) {
        sendError(res, 404, "not_found", "Project not found");
        return;
      }
    }
    const number = await allocateTodoNumber(db);
    const actorId = await getCurrentUserId(db);
    const [todo] = await db
      .insert(schema.todos)
      .values({
        number,
        title: body.title ?? idea.title,
        description: idea.body,
        projectId: body.projectId ?? null,
        sourceIdeaId: idea.id,
        state: "new",
        priority: "none",
        sortOrder: 0,
        createdById: actorId,
        updatedById: actorId,
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
    res.status(201).json({ data: todo });
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
    const projectId =
      parsed.projectId !== undefined ? parsed.projectId : todo.projectId;
    if (projectId != null) {
      const [proj] = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId));
      if (!proj) {
        sendError(res, 404, "not_found", "Project not found");
        return;
      }
    }
    const number = await allocateTaskNumber(db);
    const actorId = await getCurrentUserId(db);
    let description = todo.description ?? "";
    if (todo.actionBy) {
      const note = `Action by: ${todo.actionBy.toISOString()}`;
      description = description ? `${description}\n\n${note}` : note;
    }
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
    res.status(201).json({ data: task });
  } catch (err) {
    handleRouteError(res, err);
  }
});
