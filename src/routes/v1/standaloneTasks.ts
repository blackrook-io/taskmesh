import { and, desc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import {
  dueDateSchema,
  taskPrioritySchema,
  taskStateSchema,
} from "../../lib/taskFields.js";
import {
  allocateTaskNumber,
  assertParentCompatible,
  nextSiblingSortOrder,
  recordTaskChanges,
  wouldCreateParentCycle,
} from "../../services/tasks.js";

const idParam = z.coerce.number().int().positive();

const createBody = z.object({
  title: z.string().min(1).max(2000),
  description: z.string().max(50_000).optional().nullable(),
  dueDate: dueDateSchema,
  color: z.string().max(64).optional().nullable(),
  state: taskStateSchema.optional(),
  priority: taskPrioritySchema.optional(),
  parentId: z.number().int().positive().optional().nullable(),
});

const patchBody = z.object({
  title: z.string().min(1).max(2000).optional(),
  description: z.string().max(50_000).optional().nullable(),
  dueDate: dueDateSchema,
  color: z.string().max(64).optional().nullable(),
  state: taskStateSchema.optional(),
  priority: taskPrioritySchema.optional(),
  parentId: z.number().int().positive().nullable().optional(),
  projectId: z.number().int().positive().nullable().optional(),
  phaseId: z.number().int().positive().nullable().optional(),
});

const listQuery = z.object({
  /** `null` string = unassigned only; omit = all; number = that project */
  projectId: z
    .union([z.literal("null"), z.coerce.number().int().positive()])
    .optional(),
  state: taskStateSchema.optional(),
});

/** Top-level tasks (including projectId null). */
export const standaloneTasksRouter = Router();

standaloneTasksRouter.get("/", async (req, res) => {
  try {
    const parsed = listQuery.parse({
      projectId: req.query.projectId as string | undefined,
      state: req.query.state as string | undefined,
    });
    const filters = [];
    if (parsed.projectId === "null") {
      filters.push(isNull(schema.tasks.projectId));
    } else if (typeof parsed.projectId === "number") {
      filters.push(eq(schema.tasks.projectId, parsed.projectId));
    }
    if (parsed.state) {
      filters.push(eq(schema.tasks.state, parsed.state));
    }
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(schema.tasks.updatedAt), desc(schema.tasks.id));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

standaloneTasksRouter.get("/:taskId", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!row) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

standaloneTasksRouter.post("/", async (req, res) => {
  try {
    const parsed = createBody.parse(req.body);
    const parentId = parsed.parentId ?? null;
    const parentOk = await assertParentCompatible(db, null, parentId);
    if (!parentOk.ok) {
      sendError(res, 400, "invalid_parent", parentOk.message);
      return;
    }
    const number = await allocateTaskNumber(db);
    const sortOrder = await nextSiblingSortOrder(db, null, parentId);
    const [row] = await db
      .insert(schema.tasks)
      .values({
        projectId: null,
        phaseId: null,
        parentId,
        number,
        title: parsed.title,
        description: parsed.description ?? null,
        state: parsed.state ?? "new",
        priority: parsed.priority ?? "none",
        dueDate: parsed.dueDate ?? null,
        color: parsed.color ?? null,
        sortOrder,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create task");
      return;
    }
    res.status(201).json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

standaloneTasksRouter.patch("/:taskId", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const parsed = patchBody.parse(req.body);
    const [existing] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!existing) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }

    let nextProjectId =
      parsed.projectId !== undefined ? parsed.projectId : existing.projectId;
    let nextPhaseId = parsed.phaseId !== undefined ? parsed.phaseId : existing.phaseId;
    let nextParentId = parsed.parentId !== undefined ? parsed.parentId : existing.parentId;

    if (parsed.projectId !== undefined && parsed.projectId !== existing.projectId) {
      if (parsed.projectId === null) {
        nextPhaseId = null;
      } else {
        const [proj] = await db
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.id, parsed.projectId));
        if (!proj) {
          sendError(res, 400, "invalid_project", "Project not found");
          return;
        }
        // Keep phase only if it already belongs to the target project; otherwise unassigned.
        if (parsed.phaseId === undefined) {
          if (existing.phaseId != null) {
            const [ph] = await db
              .select()
              .from(schema.projectPhases)
              .where(eq(schema.projectPhases.id, existing.phaseId));
            nextPhaseId = ph && ph.projectId === parsed.projectId ? existing.phaseId : null;
          } else {
            nextPhaseId = null;
          }
        }
      }
      // Parent must share project scope; clear when project changes unless client set parent.
      if (parsed.parentId === undefined) {
        nextParentId = null;
      }
    }

    if (nextPhaseId != null && nextProjectId != null) {
      const [ph] = await db
        .select()
        .from(schema.projectPhases)
        .where(eq(schema.projectPhases.id, nextPhaseId));
      if (!ph || ph.projectId !== nextProjectId) {
        sendError(res, 400, "invalid_phase", "Phase does not belong to project");
        return;
      }
    }
    if (nextPhaseId != null && nextProjectId == null) {
      sendError(res, 400, "invalid_phase", "Phase requires a project");
      return;
    }

    if (parsed.parentId !== undefined || nextParentId !== existing.parentId) {
      if (await wouldCreateParentCycle(db, taskId, nextParentId)) {
        sendError(res, 400, "invalid_parent", "Parent would create a cycle");
        return;
      }
      const parentOk = await assertParentCompatible(db, nextProjectId, nextParentId);
      if (!parentOk.ok) {
        sendError(res, 400, "invalid_parent", parentOk.message);
        return;
      }
    }

    const [row] = await db
      .update(schema.tasks)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(parsed.dueDate !== undefined ? { dueDate: parsed.dueDate } : {}),
        ...(parsed.color !== undefined ? { color: parsed.color } : {}),
        ...(parsed.state !== undefined ? { state: parsed.state } : {}),
        ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
        ...(parsed.projectId !== undefined || nextProjectId !== existing.projectId
          ? { projectId: nextProjectId }
          : {}),
        ...(parsed.phaseId !== undefined || nextPhaseId !== existing.phaseId
          ? { phaseId: nextPhaseId }
          : {}),
        ...(parsed.parentId !== undefined || nextParentId !== existing.parentId
          ? { parentId: nextParentId }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, taskId))
      .returning();
    if (row) {
      await recordTaskChanges(db, taskId, existing, row);
    }
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

standaloneTasksRouter.delete("/:taskId", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const deleted = await db
      .delete(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .returning({ id: schema.tasks.id });
    if (!deleted[0]) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
