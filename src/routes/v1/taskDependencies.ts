import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { activitySourceFromRequest } from "../../lib/activityRequest.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import {
  addDependency,
  formatBlockersMessage,
  listDependsOn,
  listRequiredBy,
  openDependsOnBlockers,
  openRequiredByBlockers,
  removeDependency,
  searchTasksForDependency,
} from "../../services/taskDependencies.js";
import { getCurrentUserId } from "../../services/users.js";

const idParam = z.coerce.number().int().positive();

const addBody = z.object({
  dependsOnTaskId: z.number().int().positive(),
});

const searchQuery = z.object({
  q: z.string().min(1).max(200),
  excludeTaskId: z.coerce.number().int().positive().optional(),
});

export const taskDependenciesRouter = Router();

taskDependenciesRouter.get("/dependency-search", async (req, res) => {
  try {
    const parsed = searchQuery.parse({
      q: req.query.q,
      excludeTaskId: req.query.excludeTaskId,
    });
    const excludeIds = parsed.excludeTaskId != null ? [parsed.excludeTaskId] : [];
    const data = await searchTasksForDependency(db, parsed.q, { excludeIds });
    res.json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

taskDependenciesRouter.get("/:taskId/dependencies", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const [task] = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId));
    if (!task) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    const dependsOn = await listDependsOn(db, taskId);
    const requiredBy = await listRequiredBy(db, taskId);
    res.json({ data: { dependsOn, requiredBy } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

taskDependenciesRouter.post("/:taskId/dependencies", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const parsed = addBody.parse(req.body);
    const actorId = await getCurrentUserId(db);
    const result = await addDependency(db, taskId, parsed.dependsOnTaskId, {
      actorId,
      source: activitySourceFromRequest(req),
    });
    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : 400;
      sendError(res, status, result.code, result.message);
      return;
    }
    res.status(201).json({ data: { dependsOn: result.dependsOn, requiredBy: result.requiredBy } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

taskDependenciesRouter.delete(
  "/:taskId/dependencies/:dependsOnTaskId",
  async (req, res) => {
    try {
      const taskId = idParam.parse(req.params.taskId);
      const dependsOnTaskId = idParam.parse(req.params.dependsOnTaskId);
      const actorId = await getCurrentUserId(db);
      const result = await removeDependency(db, taskId, dependsOnTaskId, {
        actorId,
        source: activitySourceFromRequest(req),
      });
      if (!result.ok) {
        const status = result.code === "not_found" ? 404 : 400;
        sendError(res, status, result.code, result.message);
        return;
      }
      res.json({ data: { dependsOn: result.dependsOn, requiredBy: result.requiredBy } });
    } catch (err) {
      handleRouteError(res, err);
    }
  },
);

/** Shared helpers used by task PATCH/DELETE routes. */
export async function rejectCompleteIfBlocked(
  taskId: number,
  nextState: string | undefined,
): Promise<{ blocked: true; message: string } | { blocked: false }> {
  if (nextState !== "complete") return { blocked: false };
  const blockers = await openDependsOnBlockers(db, taskId);
  if (blockers.length === 0) return { blocked: false };
  return { blocked: true, message: formatBlockersMessage("complete", blockers) };
}

export async function rejectDeleteIfBlocked(
  taskId: number,
): Promise<{ blocked: true; message: string } | { blocked: false }> {
  const blockers = await openRequiredByBlockers(db, taskId);
  if (blockers.length === 0) return { blocked: false };
  return { blocked: true, message: formatBlockersMessage("delete", blockers) };
}
