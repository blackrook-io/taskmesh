import { and, asc, eq, ne } from "drizzle-orm";
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
import { optionalMarkdown, optionalPlainTitle, plainTitle } from "../../lib/markdownFields.js";
import { parseRouteId } from "../../lib/routeParams.js";
import {
  dueDateSchema,
  selectableTaskStateSchema,
  taskPrioritySchema,
} from "../../lib/taskFields.js";
import {
  afterTaskHierarchyChange,
  resolvePersistedState,
} from "../../services/taskPending.js";
import {
  allocateTaskNumber,
  assertParentCompatible,
  assertPhaseForProject,
  inheritPhaseFromParent,
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
  rejectDeleteIfHasChildren,
} from "./taskDependencies.js";
import { applyTaskGroupAutoTags } from "../../services/taskGroupAutoTag.js";

const taskBody = z.object({
  title: plainTitle(2000),
  description: optionalMarkdown(50_000),
  dueDate: dueDateSchema,
  /** @deprecated Accept datetime for older clients; stored as dueDate date part. */
  dueAt: z.string().datetime().optional().nullable(),
  color: z.string().max(64).optional().nullable(),
  phaseId: z.number().int().positive().optional().nullable(),
  parentId: z.number().int().positive().optional().nullable(),
  state: selectableTaskStateSchema.optional(),
  priority: taskPrioritySchema.optional(),
  sortOrder: z.number().int().optional(),
});

const taskPatch = z.object({
  title: optionalPlainTitle(2000),
  description: optionalMarkdown(50_000),
  dueDate: dueDateSchema,
  dueAt: z.string().datetime().optional().nullable(),
  color: z.string().max(64).optional().nullable(),
  phaseId: z.number().int().positive().optional().nullable(),
  parentId: z.number().int().positive().nullable().optional(),
  state: selectableTaskStateSchema.optional(),
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
      .where(and(eq(schema.tasks.projectId, projectId), ne(schema.tasks.state, "deleted")))
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

    const parentId = parsed.parentId ?? null;
    const parentOk = await assertParentCompatible(db, projectId, parentId);
    if (!parentOk.ok) {
      sendError(res, 400, "invalid_parent", parentOk.message);
      return;
    }

    if (parentId != null) {
      phaseId = await inheritPhaseFromParent(db, parentId);
    } else {
      const phaseOk = await assertPhaseForProject(db, projectId, phaseId);
      if (!phaseOk.ok) {
        sendError(res, 400, "invalid_phase", phaseOk.message);
        return;
      }
    }

    const nextSort =
      parsed.sortOrder ?? (await nextSiblingSortOrder(db, projectId, parentId));
    const number = await allocateTaskNumber(db);
    const dueDate = resolveDueDate(parsed) ?? null;
    const initialState = parsed.state ?? "new";

    const [row] = await db
      .insert(schema.tasks)
      .values({
        projectId,
        phaseId,
        parentId,
        number,
        title: parsed.title,
        description: parsed.description ?? null,
        state: initialState,
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
    await afterTaskHierarchyChange(db, row.id, null, {
      actorId,
      source: activitySourceFromRequest(req),
      recordHistory: shouldRecordHistory(req),
    });
    await applyTaskGroupAutoTags(db, { projectId, taskId: row.id });
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

    if (parsed.phaseId !== undefined) {
      const phaseOk = await assertPhaseForProject(db, projectId, parsed.phaseId);
      if (!phaseOk.ok) {
        sendError(res, 400, "invalid_phase", phaseOk.message);
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
      .where(and(eq(schema.tasks.projectId, projectId), ne(schema.tasks.state, "deleted")))
      .orderBy(asc(schema.tasks.sortOrder), asc(schema.tasks.id));
    if (parsed.phaseId !== undefined) {
      await applyTaskGroupAutoTags(db, { projectId });
    }
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
    if (existing.state === "deleted") {
      sendError(
        res,
        400,
        "task_deleted",
        "Cannot update a deleted task; restore it from Administration first",
      );
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

    const nextParentId = parsed.parentId !== undefined ? parsed.parentId : existing.parentId;
    let nextPhaseId = parsed.phaseId !== undefined ? parsed.phaseId : existing.phaseId;
    if (nextParentId != null) {
      nextPhaseId = await inheritPhaseFromParent(db, nextParentId);
    } else {
      const phaseOk = await assertPhaseForProject(db, projectId, nextPhaseId);
      if (!phaseOk.ok) {
        sendError(res, 400, "invalid_phase", phaseOk.message);
        return;
      }
    }

    const completeGate = await rejectCompleteIfBlocked(taskId, parsed.state);
    if (completeGate.blocked) {
      sendError(res, 400, "dependency_incomplete", completeGate.message);
      return;
    }

    const persistedState = await resolvePersistedState(db, taskId, parsed.state);
    const previousParentId = existing.parentId;

    const [row] = await db
      .update(schema.tasks)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(dueDate !== undefined ? { dueDate } : {}),
        ...(parsed.color !== undefined ? { color: parsed.color } : {}),
        ...(nextPhaseId !== existing.phaseId || parsed.phaseId !== undefined
          ? { phaseId: nextPhaseId }
          : {}),
        ...(parsed.parentId !== undefined ? { parentId: parsed.parentId } : {}),
        ...(persistedState !== undefined ? { state: persistedState } : {}),
        ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
        updatedAt: new Date(),
        updatedById: actorId,
      })
      .where(eq(schema.tasks.id, taskId))
      .returning();

    if (row && row.phaseId !== existing.phaseId) {
      await syncDescendantPhases(db, taskId, row.phaseId, actorId);
    }

    const activityOpts = {
      actorId,
      source: activitySourceFromRequest(req),
      recordHistory: shouldRecordHistory(req),
    };
    if (row) {
      await recordTaskChanges(db, taskId, existing, row, activityOpts);
      await afterTaskHierarchyChange(db, taskId, previousParentId, activityOpts);
      await applyTaskGroupAutoTags(db, { projectId, taskId });
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
    if (existing.state === "deleted") {
      sendError(res, 400, "already_deleted", "Task is already deleted");
      return;
    }
    const deleteGate = await rejectDeleteIfBlocked(taskId);
    if (deleteGate.blocked) {
      sendError(res, 400, "dependency_required_by", deleteGate.message);
      return;
    }
    const childGate = await rejectDeleteIfHasChildren(taskId);
    if (childGate.blocked) {
      sendError(res, 400, "has_children", childGate.message);
      return;
    }
    const actorId = await getCurrentUserId(db);
    const [row] = await db
      .update(schema.tasks)
      .set({
        state: "deleted",
        updatedAt: new Date(),
        updatedById: actorId,
      })
      .where(eq(schema.tasks.id, taskId))
      .returning();
    if (!row || row.projectId !== projectId) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    await recordTaskChanges(db, taskId, existing, row, {
      actorId,
      source: activitySourceFromRequest(req),
      recordHistory: shouldRecordHistory(req),
    });
    await afterTaskHierarchyChange(db, taskId, existing.parentId, {
      actorId,
      source: activitySourceFromRequest(req),
      recordHistory: shouldRecordHistory(req),
    });
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
