import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { activitySourceFromRequest } from "../../lib/activityRequest.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { dueDateSchema, estimateHoursSchema } from "../../lib/taskFields.js";
import { recordTaskChanges, type TaskLike } from "../../services/tasks.js";
import { assertCanAccessDualScoped } from "../../services/ownership.js";
import { getCurrentUserId } from "../../services/users.js";
import { registerCommentRoutes, serializeActivityRows } from "./entityActivityRoutes.js";

const idParam = z.coerce.number().int().positive();

const sessionBody = z.object({
  before: z.object({
    title: z.string(),
    description: z.string().nullable(),
    state: z.string(),
    priority: z.string(),
    dueDate: dueDateSchema,
    estimateHours: estimateHoursSchema,
    color: z.string().nullable(),
    phaseId: z.number().int().positive().nullable(),
    parentId: z.number().int().positive().nullable(),
    projectId: z.number().int().positive().nullable(),
    assigneeId: z.number().int().positive().nullable().optional(),
  }),
});

/** Task history timeline: comments (editable) + auto-recorded field changes. */
export const taskActivityRouter = Router();

registerCommentRoutes(taskActivityRouter, "task", "taskId");

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
    await assertCanAccessDualScoped(db, actorId, task, "write");
    const before: TaskLike = {
      title: parsed.before.title,
      description: parsed.before.description,
      state: parsed.before.state,
      priority: parsed.before.priority,
      dueDate: parsed.before.dueDate ?? null,
      estimateHours:
        parsed.before.estimateHours !== undefined
          ? parsed.before.estimateHours
          : task.estimateHours,
      color: parsed.before.color,
      phaseId: parsed.before.phaseId,
      parentId: parsed.before.parentId,
      projectId: parsed.before.projectId,
      assigneeId: parsed.before.assigneeId ?? null,
    };
    const after: TaskLike = {
      title: task.title,
      description: task.description,
      state: task.state,
      priority: task.priority,
      dueDate: task.dueDate,
      estimateHours: task.estimateHours,
      color: task.color,
      phaseId: task.phaseId,
      parentId: task.parentId,
      projectId: task.projectId,
      assigneeId: task.assigneeId,
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
