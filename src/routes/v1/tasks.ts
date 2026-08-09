import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import {
  activitySourceFromRequest,
  shouldRecordHistory,
} from "../../lib/activityRequest.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { parseRouteId } from "../../lib/routeParams.js";
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
  syncDescendantPhases,
  wouldCreateParentCycle,
} from "../../services/tasks.js";
import {
  attachTaskActor,
  attachTaskActors,
  getCurrentUserId,
} from "../../services/users.js";
import {
  rejectCompleteIfBlocked,
  rejectDeleteIfBlocked,
} from "./taskDependencies.js";

const taskBody = z.object({
  title: z.string().min(1).max(2000),
  description: z.string().max(50_000).optional().nullable(),
  dueDate: dueDateSchema,
  /** @deprecated Accept datetime for older clients; stored as dueDate date part. */
  dueAt: z.string().datetime().optional().nullable(),
  color: z.string().max(64).optional().nullable(),
  phaseId: z.number().int().positive().optional().nullable(),
  parentId: z.number().int().positive().optional().nullable(),
  state: taskStateSchema.optional(),
  priority: taskPrioritySchema.optional(),
  sortOrder: z.number().int().optional(),
});

const taskPatch = z.object({
  title: z.string().min(1).max(2000).optional(),
  description: z.string().max(50_000).optional().nullable(),
  dueDate: dueDateSchema,
  dueAt: z.string().datetime().optional().nullable(),
  color: z.string().max(64).optional().nullable(),
  phaseId: z.number().int().positive().optional().nullable(),
  parentId: z.number().int().positive().nullable().optional(),
  state: taskStateSchema.optional(),
  priority: taskPrioritySchema.optional(),
  sortOrder: z.number().int().optional(),
});

const reorderBody = z.object({
  /** Sibling order (roots or children under the same parent). */
  orderedTaskIds: z.array(z.number().int().positive()).min(1),
  /** Scope: reorder among children of this parent (null = top-level). */
  parentId: z.number().int().positive().nullable().optional(),
  /** When set, apply this phaseId to each reordered root (and sync descendants). */
  phaseId: z.number().int().positive().nullable().optional(),
});

function resolveDueDate(input: {
  dueDate?: string | null;
  dueAt?: string | null;
}): string | null | undefined {
  if (input.dueDate !== undefined) return input.dueDate;
  if (input.dueAt === undefined) return undefined;
  if (input.dueAt === null) return null;
  return input.dueAt.slice(0, 10);
}

export const tasksRouter = Router({ mergeParams: true });

tasksRouter.get("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId))
      .orderBy(asc(schema.tasks.sortOrder), asc(schema.tasks.id));
    res.json({ data: await attachTaskActors(db, rows) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

tasksRouter.post("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const parsed = taskBody.parse(req.body);
    const actorId = await getCurrentUserId(db);

    let phaseId: number | null = parsed.phaseId ?? null;
    if (parsed.phaseId != null) {
      const [ph] = await db
        .select()
        .from(schema.projectPhases)
        .where(eq(schema.projectPhases.id, parsed.phaseId));
      if (!ph || ph.projectId !== projectId) {
        sendError(res, 400, "invalid_phase", "Phase does not belong to this project");
        return;
      }
      phaseId = ph.id;
    }

    const parentId = parsed.parentId ?? null;
    const parentOk = await assertParentCompatible(db, projectId, parentId);
    if (!parentOk.ok) {
      sendError(res, 400, "invalid_parent", parentOk.message);
      return;
    }

    if (parentId != null) {
      const [parent] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, parentId));
      if (parent?.phaseId != null) {
        phaseId = parent.phaseId;
      }
    }

    const nextSort =
      parsed.sortOrder ?? (await nextSiblingSortOrder(db, projectId, parentId));
    const number = await allocateTaskNumber(db);
    const dueDate = resolveDueDate(parsed) ?? null;

    const [row] = await db
      .insert(schema.tasks)
      .values({
        projectId,
        phaseId,
        parentId,
        number,
        title: parsed.title,
        description: parsed.description ?? null,
        state: parsed.state ?? "new",
        priority: parsed.priority ?? "none",
        dueDate,
        color: parsed.color ?? null,
        sortOrder: nextSort,
        createdById: actorId,
        updatedById: actorId,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create task");
      return;
    }
    res.status(201).json({ data: await attachTaskActor(db, row) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

tasksRouter.patch("/reorder", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const parsed = reorderBody.parse(req.body);
    const actorId = await getCurrentUserId(db);

    if (parsed.orderedTaskIds.length === 0) {
      sendError(res, 400, "invalid_reorder", "orderedTaskIds required");
      return;
    }

    const projectTasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId));
    const byId = new Map(projectTasks.map((t) => [t.id, t]));

    const seen = new Set<number>();
    for (const tid of parsed.orderedTaskIds) {
      const t = byId.get(tid);
      if (!t) {
        sendError(res, 400, "invalid_task", `Task ${tid} is not in this project`);
        return;
      }
      if (seen.has(tid)) {
        sendError(res, 400, "invalid_reorder", "Duplicate task id in orderedTaskIds");
        return;
      }
      seen.add(tid);
    }

    if (parsed.phaseId !== undefined && parsed.phaseId != null) {
      const [ph] = await db
        .select()
        .from(schema.projectPhases)
        .where(eq(schema.projectPhases.id, parsed.phaseId));
      if (!ph || ph.projectId !== projectId) {
        sendError(res, 400, "invalid_phase", "Phase does not belong to this project");
        return;
      }
    }

    for (let i = 0; i < parsed.orderedTaskIds.length; i++) {
      const tid = parsed.orderedTaskIds[i];
      if (tid === undefined) continue;
      const set: {
        sortOrder: number;
        updatedAt: Date;
        updatedById: number;
        phaseId?: number | null;
        parentId?: number | null;
      } = { sortOrder: i, updatedAt: new Date(), updatedById: actorId };
      if (parsed.parentId !== undefined) {
        set.parentId = parsed.parentId;
      }
      if (parsed.phaseId !== undefined) {
        set.phaseId = parsed.phaseId;
      }
      await db.update(schema.tasks).set(set).where(eq(schema.tasks.id, tid));
      if (parsed.phaseId !== undefined) {
        await syncDescendantPhases(db, tid, parsed.phaseId, actorId);
      }
    }

    const rows = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId))
      .orderBy(asc(schema.tasks.sortOrder), asc(schema.tasks.id));
    res.json({ data: await attachTaskActors(db, rows) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

tasksRouter.get("/:taskId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const taskId = parseRouteId(req, "taskId");
    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!row || row.projectId !== projectId) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    res.json({ data: await attachTaskActor(db, row) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

tasksRouter.patch("/:taskId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const taskId = parseRouteId(req, "taskId");
    const parsed = taskPatch.parse(req.body);
    const actorId = await getCurrentUserId(db);
    const [existing] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!existing || existing.projectId !== projectId) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }

    const dueDate = resolveDueDate(parsed);
    const hasFieldChange =
      hasDefinedKeys(parsed, [
        "title",
        "description",
        "dueDate",
        "dueAt",
        "color",
        "phaseId",
        "parentId",
        "state",
        "priority",
        "sortOrder",
      ]) || dueDate !== undefined;
    if (!hasFieldChange) {
      sendError(res, 400, "empty_patch", "No updatable fields provided");
      return;
    }

    if (parsed.phaseId != null) {
      const [ph] = await db
        .select()
        .from(schema.projectPhases)
        .where(eq(schema.projectPhases.id, parsed.phaseId));
      if (!ph || ph.projectId !== projectId) {
        sendError(res, 400, "invalid_phase", "Phase does not belong to this project");
        return;
      }
    }

    if (parsed.parentId !== undefined) {
      if (await wouldCreateParentCycle(db, taskId, parsed.parentId)) {
        sendError(res, 400, "invalid_parent", "Parent would create a cycle");
        return;
      }
      const parentOk = await assertParentCompatible(db, projectId, parsed.parentId);
      if (!parentOk.ok) {
        sendError(res, 400, "invalid_parent", parentOk.message);
        return;
      }
    }

    const completeGate = await rejectCompleteIfBlocked(taskId, parsed.state);
    if (completeGate.blocked) {
      sendError(res, 400, "dependency_incomplete", completeGate.message);
      return;
    }

    const [row] = await db
      .update(schema.tasks)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(dueDate !== undefined ? { dueDate } : {}),
        ...(parsed.color !== undefined ? { color: parsed.color } : {}),
        ...(parsed.phaseId !== undefined ? { phaseId: parsed.phaseId } : {}),
        ...(parsed.parentId !== undefined ? { parentId: parsed.parentId } : {}),
        ...(parsed.state !== undefined ? { state: parsed.state } : {}),
        ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
        updatedAt: new Date(),
        updatedById: actorId,
      })
      .where(eq(schema.tasks.id, taskId))
      .returning();

    if (row && parsed.phaseId !== undefined) {
      await syncDescendantPhases(db, taskId, parsed.phaseId, actorId);
    }

    if (row) {
      await recordTaskChanges(db, taskId, existing, row, {
        actorId,
        source: activitySourceFromRequest(req),
        recordHistory: shouldRecordHistory(req),
      });
    }

    res.json({ data: row ? await attachTaskActor(db, row) : row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

tasksRouter.delete("/:taskId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const taskId = parseRouteId(req, "taskId");
    const [existing] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!existing || existing.projectId !== projectId) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    const deleteGate = await rejectDeleteIfBlocked(taskId);
    if (deleteGate.blocked) {
      sendError(res, 400, "dependency_required_by", deleteGate.message);
      return;
    }
    const deleted = await db
      .delete(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .returning({ id: schema.tasks.id, projectId: schema.tasks.projectId });
    const d = deleted[0];
    if (!d || d.projectId !== projectId) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
