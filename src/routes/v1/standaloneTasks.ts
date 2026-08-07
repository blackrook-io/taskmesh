import { eq } from "drizzle-orm";
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
  wouldCreateParentCycle,
} from "../../services/tasks.js";

const idParam = z.coerce.number().int().positive();

const createBody = z.object({
  title: z.string().min(1).max(2000),
  notes: z.string().max(50_000).optional().nullable(),
  dueDate: dueDateSchema,
  color: z.string().max(64).optional().nullable(),
  state: taskStateSchema.optional(),
  priority: taskPrioritySchema.optional(),
  parentId: z.number().int().positive().optional().nullable(),
});

const patchBody = z.object({
  title: z.string().min(1).max(2000).optional(),
  notes: z.string().max(50_000).optional().nullable(),
  dueDate: dueDateSchema,
  color: z.string().max(64).optional().nullable(),
  state: taskStateSchema.optional(),
  priority: taskPrioritySchema.optional(),
  parentId: z.number().int().positive().nullable().optional(),
  projectId: z.number().int().positive().nullable().optional(),
});

/** Top-level tasks (including projectId null). */
export const standaloneTasksRouter = Router();

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
        notes: parsed.notes ?? null,
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
    if (parsed.parentId !== undefined) {
      if (await wouldCreateParentCycle(db, taskId, parsed.parentId)) {
        sendError(res, 400, "invalid_parent", "Parent would create a cycle");
        return;
      }
      const projectId =
        parsed.projectId !== undefined ? parsed.projectId : existing.projectId;
      const parentOk = await assertParentCompatible(db, projectId, parsed.parentId);
      if (!parentOk.ok) {
        sendError(res, 400, "invalid_parent", parentOk.message);
        return;
      }
    }
    const [row] = await db
      .update(schema.tasks)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
        ...(parsed.dueDate !== undefined ? { dueDate: parsed.dueDate } : {}),
        ...(parsed.color !== undefined ? { color: parsed.color } : {}),
        ...(parsed.state !== undefined ? { state: parsed.state } : {}),
        ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
        ...(parsed.parentId !== undefined ? { parentId: parsed.parentId } : {}),
        ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, taskId))
      .returning();
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});
