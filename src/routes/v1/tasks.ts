import { and, asc, eq, ne } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import {
  activitySourceFromRequest,
  shouldRecordHistory,
  type ActivitySource,
} from "../../lib/activityRequest.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { sendMutation, type MutationResult } from "../../lib/mutationResult.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { optionalMarkdown, optionalPlainTitle, plainTitle } from "../../lib/markdownFields.js";
import { sanitizeMarkdown } from "../../lib/sanitizeMarkdown.js";
import { parseRouteId } from "../../lib/routeParams.js";
import {
  dueDateSchema,
  selectableTaskStateSchema,
  taskPrioritySchema,
} from "../../lib/taskFields.js";
import { derivedStatePatchRejected } from "../../lib/taskRollup.js";
import { forgetKnowledge, scheduleKnowledgeIndex } from "../../services/knowledge/schedule.js";
import { syncMentionLinks } from "../../services/mentionLinks.js";
import { assertCanAccessProject } from "../../services/ownership.js";
import {
  promoteBlockedDependents,
  shouldPromoteBlockedDependents,
} from "../../services/taskBlocked.js";
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
import { resolveAssigneeId } from "../../services/assignees.js";
import {
  actorCanReopen,
  assertInitialState,
  attachAllowedNextStates,
  enforceTaskPatch,
} from "../../services/taskWorkflow.js";

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
  stateManual: z.boolean().optional(),
  priority: taskPrioritySchema.optional(),
  sortOrder: z.number().int().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
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
  stateManual: z.boolean().optional(),
  priority: taskPrioritySchema.optional(),
  sortOrder: z.number().int().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  stateComment: z
    .string()
    .max(50_000)
    .optional()
    .nullable()
    .transform((value) => (value == null ? undefined : sanitizeMarkdown(value))),
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
    const actorId = await getCurrentUserId(db);
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.projectId, projectId), ne(schema.tasks.state, "deleted")))
      .orderBy(asc(schema.tasks.sortOrder), asc(schema.tasks.id));
    const withActors = await attachTaskActors(db, rows);
    res.json({ data: await attachAllowedNextStates(db, actorId, withActors) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

export async function createProjectTask(args: {
  projectId: number;
  body: unknown;
  actorId: number;
  source: ActivitySource;
  recordHistory: boolean;
}): Promise<MutationResult> {
  const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, args.projectId));
  if (!proj) {
    return { ok: false, status: 404, code: "not_found", message: "Project not found" };
  }
  await assertCanAccessProject(db, args.actorId, args.projectId, "write");
  const parsed = taskBody.parse(args.body);

  let phaseId: number | null = parsed.phaseId ?? null;
  const parentId = parsed.parentId ?? null;
  const parentOk = await assertParentCompatible(db, args.projectId, parentId);
  if (!parentOk.ok) {
    return { ok: false, status: 400, code: "invalid_parent", message: parentOk.message };
  }

  if (parentId != null) {
    phaseId = await inheritPhaseFromParent(db, parentId);
  } else {
    const phaseOk = await assertPhaseForProject(db, args.projectId, phaseId);
    if (!phaseOk.ok) {
      return { ok: false, status: 400, code: "invalid_phase", message: phaseOk.message };
    }
  }

  assertInitialState(parsed.state);
  const nextSort = parsed.sortOrder ?? (await nextSiblingSortOrder(db, args.projectId, parentId));
  const number = await allocateTaskNumber(db);
  const dueDate = resolveDueDate(parsed) ?? null;
  const initialState = parsed.state ?? "new";
  const assigneeId = await resolveAssigneeId(db, {
    projectId: args.projectId,
    requested: parsed.assigneeId,
    creating: true,
  });

  const [row] = await db
    .insert(schema.tasks)
    .values({
      projectId: args.projectId,
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
      createdById: args.actorId,
      updatedById: args.actorId,
      ownerId: args.actorId,
      assigneeId,
    })
    .returning();
  if (!row) {
    return { ok: false, status: 500, code: "insert_failed", message: "Could not create task" };
  }
  await afterTaskHierarchyChange(db, row.id, null, {
    actorId: args.actorId,
    source: args.source,
    recordHistory: args.recordHistory,
  });
  await syncMentionLinks(db, {
    srcType: "task",
    srcId: row.id,
    markdown: row.description,
    actorUserId: args.actorId,
  });
  await applyTaskGroupAutoTags(db, { projectId: args.projectId, taskId: row.id });
  await scheduleKnowledgeIndex("task", row.id);
  const created = await attachTaskActor(db, row);
  const [data] = await attachAllowedNextStates(db, args.actorId, [created]);
  return { ok: true, status: 201, data };
}

tasksRouter.post("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const actorId = await getCurrentUserId(db);
    sendMutation(
      res,
      await createProjectTask({
        projectId,
        body: req.body,
        actorId,
        source: activitySourceFromRequest(req),
        recordHistory: shouldRecordHistory(req),
      }),
    );
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
    const withActors = await attachTaskActors(db, rows);
    res.json({ data: await attachAllowedNextStates(db, actorId, withActors) });
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
    const actorId = await getCurrentUserId(db);
    const task = await attachTaskActor(db, row);
    const [data] = await attachAllowedNextStates(db, actorId, [task]);
    res.json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

export async function patchProjectTask(args: {
  projectId: number;
  taskId: number;
  body: unknown;
  actorId: number;
  source: ActivitySource;
  recordHistory: boolean;
}): Promise<MutationResult> {
  await assertCanAccessProject(db, args.actorId, args.projectId, "write");
  const parsed = taskPatch.parse(args.body);
  const [existing] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, args.taskId));
  if (!existing || existing.projectId !== args.projectId) {
    return { ok: false, status: 404, code: "not_found", message: "Task not found" };
  }
  if (existing.state === "deleted") {
    return {
      ok: false,
      status: 400,
      code: "task_deleted",
      message: "Cannot update a deleted task; restore it from Administration first",
    };
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
      "stateManual",
      "priority",
      "sortOrder",
      "assigneeId",
    ]) || dueDate !== undefined;
  if (!hasFieldChange) {
    return { ok: false, status: 400, code: "empty_patch", message: "No updatable fields provided" };
  }

  if (derivedStatePatchRejected(existing, parsed)) {
    return {
      ok: false,
      status: 400,
      code: "state_derived",
      message:
        "Status is derived from child tasks. Turn on Manual status to set it yourself.",
    };
  }

  const canReopen = await actorCanReopen(db, args.actorId, existing.projectId);
  enforceTaskPatch({
    fromState: existing.state,
    canReopen,
    patch: { ...parsed, dueDate },
  });

  const nextAssigneeId =
    parsed.assigneeId !== undefined
      ? await resolveAssigneeId(db, {
          projectId: args.projectId,
          requested: parsed.assigneeId,
          previousAssigneeId: existing.assigneeId,
        })
      : existing.assigneeId;

  if (parsed.parentId !== undefined) {
    if (await wouldCreateParentCycle(db, args.taskId, parsed.parentId)) {
      return { ok: false, status: 400, code: "invalid_parent", message: "Parent would create a cycle" };
    }
    const parentOk = await assertParentCompatible(db, args.projectId, parsed.parentId);
    if (!parentOk.ok) {
      return { ok: false, status: 400, code: "invalid_parent", message: parentOk.message };
    }
  }

  const nextParentId = parsed.parentId !== undefined ? parsed.parentId : existing.parentId;
  let nextPhaseId = parsed.phaseId !== undefined ? parsed.phaseId : existing.phaseId;
  if (nextParentId != null) {
    nextPhaseId = await inheritPhaseFromParent(db, nextParentId);
  } else {
    const phaseOk = await assertPhaseForProject(db, args.projectId, nextPhaseId);
    if (!phaseOk.ok) {
      return { ok: false, status: 400, code: "invalid_phase", message: phaseOk.message };
    }
  }

  const completeGate = await rejectCompleteIfBlocked(args.taskId, parsed.state);
  if (completeGate.blocked) {
    return { ok: false, status: 400, code: "dependency_incomplete", message: completeGate.message };
  }

  const persistedState = await resolvePersistedState(db, args.taskId, existing.state, parsed.state);
  const previousParentId = existing.parentId;
  const stateComment = parsed.stateComment?.trim() ?? "";

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
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
        ...(parsed.stateManual !== undefined ? { stateManual: parsed.stateManual } : {}),
        ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
        ...(parsed.assigneeId !== undefined ? { assigneeId: nextAssigneeId } : {}),
        updatedAt: new Date(),
        updatedById: args.actorId,
      })
      .where(eq(schema.tasks.id, args.taskId))
      .returning();
    if (updated && stateComment && updated.state !== existing.state) {
      await tx.insert(schema.taskActivity).values({
        taskId: args.taskId,
        entityType: "task",
        entityId: args.taskId,
        kind: "comment",
        body: stateComment,
        createdById: args.actorId,
        source: args.source,
      });
    }
    return updated;
  });

  if (row && row.phaseId !== existing.phaseId) {
    await syncDescendantPhases(db, args.taskId, row.phaseId, args.actorId);
  }

  const activityOpts = {
    actorId: args.actorId,
    source: args.source,
    recordHistory: args.recordHistory,
  };
  if (row) {
    await recordTaskChanges(db, args.taskId, existing, row, activityOpts);
    await afterTaskHierarchyChange(db, args.taskId, previousParentId, activityOpts);
    if (shouldPromoteBlockedDependents(existing.state, row.state)) {
      await promoteBlockedDependents(db, args.taskId, activityOpts);
    }
    if (parsed.description !== undefined) {
      await syncMentionLinks(db, {
        srcType: "task",
        srcId: row.id,
        markdown: row.description,
        actorUserId: args.actorId,
      });
    }
    await applyTaskGroupAutoTags(db, { projectId: args.projectId, taskId: args.taskId });
    if (row.state === "deleted") await forgetKnowledge("task", row.id);
    else await scheduleKnowledgeIndex("task", row.id);
  }

  if (!row) {
    return { ok: true, status: 200, data: row };
  }
  const [fresh] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, args.taskId));
  const updated = await attachTaskActor(db, fresh ?? row);
  const [data] = await attachAllowedNextStates(db, args.actorId, [updated]);
  return { ok: true, status: 200, data };
}

tasksRouter.patch("/:taskId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const taskId = parseRouteId(req, "taskId");
    const actorId = await getCurrentUserId(db);
    sendMutation(
      res,
      await patchProjectTask({
        projectId,
        taskId,
        body: req.body,
        actorId,
        source: activitySourceFromRequest(req),
        recordHistory: shouldRecordHistory(req),
      }),
    );
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
    const activityOpts = {
      actorId,
      source: activitySourceFromRequest(req),
      recordHistory: shouldRecordHistory(req),
    };
    await afterTaskHierarchyChange(db, taskId, existing.parentId, activityOpts);
    if (shouldPromoteBlockedDependents(existing.state, row.state)) {
      await promoteBlockedDependents(db, taskId, activityOpts);
    }
    await forgetKnowledge("task", taskId);
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
