import { and, desc, eq, isNull, ne } from "drizzle-orm";
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
import { dateOrderViolation } from "../../lib/dateOrder.js";
import {
  dueDateSchema,
  estimateHoursSchema,
  startDateSchema,
  selectableTaskStateSchema,
  taskPrioritySchema,
  taskStateSchema,
} from "../../lib/taskFields.js";
import { derivedStatePatchRejected } from "../../lib/taskRollup.js";
import { forgetKnowledge, scheduleKnowledgeIndex } from "../../services/knowledge/schedule.js";
import { syncMentionLinks } from "../../services/mentionLinks.js";
import { reportAssigneeChange } from "../../services/notifications/events.js";
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
  assertCanAccessDualScoped,
  assertCanAccessProject,
  dualScopeListFilter,
  ownerScope,
} from "../../services/ownership.js";
import { userHasAdministrator } from "../../services/roles.js";
import {
  blockReadyDependents,
  blockReadyTaskIfOpenPrerequisites,
  promoteBlockedDependents,
  shouldBlockReadyDependents,
  shouldPromoteBlockedDependents,
} from "../../services/taskBlocked.js";
import {
  afterTaskHierarchyChange,
  resolvePersistedState,
} from "../../services/taskPending.js";
import { assertParentChangeRespectsPlans } from "../../services/plans.js";
import {
  attachTaskActor,
  attachTaskActors,
  getCurrentUserId,
} from "../../services/users.js";
import { applyTaskGroupAutoTags } from "../../services/taskGroupAutoTag.js";
import { resolveAssigneeId } from "../../services/assignees.js";
import {
  actorCanReopen,
  assertInitialState,
  attachAllowedNextStates,
  enforceTaskPatch,
} from "../../services/taskWorkflow.js";
import {
  rejectCompleteIfBlocked,
  rejectDeleteIfBlocked,
  rejectDeleteIfHasChildren,
} from "./taskDependencies.js";

const idParam = z.coerce.number().int().positive();

const createBody = z.object({
  title: plainTitle(2000),
  description: optionalMarkdown(50_000),
  dueDate: dueDateSchema,
  startDate: startDateSchema,
  estimateHours: estimateHoursSchema,
  color: z.string().max(64).optional().nullable(),
  state: selectableTaskStateSchema.optional(),
  priority: taskPrioritySchema.optional(),
  parentId: z.number().int().positive().optional().nullable(),
  assigneeId: z.number().int().positive().nullable().optional(),
});

const patchBody = z.object({
  title: optionalPlainTitle(2000),
  description: optionalMarkdown(50_000),
  dueDate: dueDateSchema,
  startDate: startDateSchema,
  estimateHours: estimateHoursSchema,
  color: z.string().max(64).optional().nullable(),
  state: selectableTaskStateSchema.optional(),
  stateManual: z.boolean().optional(),
  priority: taskPrioritySchema.optional(),
  parentId: z.number().int().positive().nullable().optional(),
  projectId: z.number().int().positive().nullable().optional(),
  phaseId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  stateComment: z
    .string()
    .max(50_000)
    .optional()
    .nullable()
    .transform((value) => (value == null ? undefined : sanitizeMarkdown(value))),
});

const listQuery = z.object({
  /** `null` string = unassigned only; omit = all; number = that project */
  projectId: z
    .union([z.literal("null"), z.coerce.number().int().positive()])
    .optional(),
  state: taskStateSchema.optional(),
  /** When true (or when state=deleted), include soft-deleted tasks. */
  includeDeleted: z
    .union([z.literal("true"), z.literal("1"), z.literal("false"), z.literal("0")])
    .optional(),
});

/** Top-level tasks (including projectId null). */
export const standaloneTasksRouter = Router();

standaloneTasksRouter.get("/", async (req, res) => {
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
      filters.push(isNull(schema.tasks.projectId));
      const os = ownerScope(schema.tasks.ownerId, actorId, isAdmin);
      if (os) filters.push(os);
    } else if (typeof parsed.projectId === "number") {
      await assertCanAccessProject(db, actorId, parsed.projectId);
      filters.push(eq(schema.tasks.projectId, parsed.projectId));
    } else {
      const scope = dualScopeListFilter(
        db,
        schema.tasks.projectId,
        schema.tasks.ownerId,
        actorId,
        isAdmin,
      );
      if (scope) filters.push(scope);
    }
    if (parsed.state) {
      filters.push(eq(schema.tasks.state, parsed.state));
    } else {
      const includeDeleted =
        parsed.includeDeleted === "true" || parsed.includeDeleted === "1";
      if (!includeDeleted) {
        filters.push(ne(schema.tasks.state, "deleted"));
      }
    }
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(schema.tasks.updatedAt), desc(schema.tasks.id));
    const withActors = await attachTaskActors(db, rows);
    res.json({ data: await attachAllowedNextStates(db, actorId, withActors) });
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
    const actorId = await getCurrentUserId(db);
    await assertCanAccessDualScoped(db, actorId, row);
    await blockReadyTaskIfOpenPrerequisites(db, taskId, {
      actorId,
      source: activitySourceFromRequest(req),
    });
    const [fresh] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    const task = await attachTaskActor(db, fresh ?? row);
    const [data] = await attachAllowedNextStates(db, actorId, [task]);
    res.json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

export async function createStandaloneTask(args: {
  body: unknown;
  actorId: number;
  source: ActivitySource;
  recordHistory: boolean;
}): Promise<MutationResult> {
  const parsed = createBody.parse(args.body);
  const parentId = parsed.parentId ?? null;
  const parentOk = await assertParentCompatible(db, null, parentId);
  if (!parentOk.ok) {
    return { ok: false, status: 400, code: "invalid_parent", message: parentOk.message };
  }
  assertInitialState(parsed.state);
  const dueDate = parsed.dueDate ?? null;
  const startDate = parsed.startDate ?? null;
  const dateOrder = dateOrderViolation(startDate, dueDate);
  if (dateOrder) {
    return { ok: false, status: 400, code: "invalid_dates", message: dateOrder };
  }
  const number = await allocateTaskNumber(db);
  const sortOrder = await nextSiblingSortOrder(db, null, parentId);
  const assigneeId = await resolveAssigneeId(db, {
    projectId: null,
    requested: parsed.assigneeId,
    creating: true,
  });
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
      dueDate,
      startDate,
      estimateHours: parsed.estimateHours ?? null,
      color: parsed.color ?? null,
      sortOrder,
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
  await scheduleKnowledgeIndex("task", row.id);
  reportAssigneeChange(db, {
    actorUserId: args.actorId,
    previousAssigneeId: null,
    assigneeId,
    entityType: "task",
    entityId: row.id,
    number: row.number,
    title: row.title,
    projectId: row.projectId,
  });
  const created = await attachTaskActor(db, row);
  const [data] = await attachAllowedNextStates(db, args.actorId, [created]);
  return { ok: true, status: 201, data };
}

standaloneTasksRouter.post("/", async (req, res) => {
  try {
    const actorId = await getCurrentUserId(db);
    sendMutation(
      res,
      await createStandaloneTask({
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

standaloneTasksRouter.patch("/:taskId", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const parsed = patchBody.parse(req.body);
    const actorId = await getCurrentUserId(db);
    const [existing] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!existing) {
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
    await assertCanAccessDualScoped(db, actorId, existing, "write");

    if (
      !hasDefinedKeys(parsed, [
        "title",
        "description",
        "dueDate",
        "startDate",
        "estimateHours",
        "color",
        "state",
        "stateManual",
        "priority",
        "parentId",
        "projectId",
        "phaseId",
        "assigneeId",
      ])
    ) {
      sendError(res, 400, "empty_patch", "No updatable fields provided");
      return;
    }

    if (derivedStatePatchRejected(existing, parsed)) {
      sendError(
        res,
        400,
        "state_derived",
        "Status is derived from child tasks. Turn on Manual status to set it yourself.",
      );
      return;
    }

    const canReopen = await actorCanReopen(db, actorId, existing.projectId);
    enforceTaskPatch({
      fromState: existing.state,
      canReopen,
      patch: parsed,
    });

    let nextProjectId =
      parsed.projectId !== undefined ? parsed.projectId : existing.projectId;
    let nextPhaseId = parsed.phaseId !== undefined ? parsed.phaseId : existing.phaseId;
    let nextParentId = parsed.parentId !== undefined ? parsed.parentId : existing.parentId;
    const projectChanging =
      parsed.projectId !== undefined && parsed.projectId !== existing.projectId;

    if (parsed.projectId !== undefined && parsed.projectId !== existing.projectId) {
      if (parsed.projectId === null) {
        nextPhaseId = null;
      } else {
        await assertCanAccessProject(db, actorId, parsed.projectId, "write");
        // Project Phases are project-scoped; drop unless the client set a new phase.
        if (parsed.phaseId === undefined) {
          nextPhaseId = null;
        }
      }
      // Parent must share project scope; clear when project changes unless client set parent.
      if (parsed.parentId === undefined) {
        nextParentId = null;
      }
    }

    const nextAssigneeId = await resolveAssigneeId(db, {
      projectId: nextProjectId,
      requested: parsed.assigneeId,
      previousAssigneeId: existing.assigneeId,
      projectChanging,
    });

    if (nextParentId != null) {
      nextPhaseId = await inheritPhaseFromParent(db, nextParentId);
    } else {
      const phaseOk = await assertPhaseForProject(db, nextProjectId, nextPhaseId);
      if (!phaseOk.ok) {
        sendError(res, 400, "invalid_phase", phaseOk.message);
        return;
      }
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
    if (nextParentId != null && nextParentId !== existing.parentId) {
      await assertParentChangeRespectsPlans(db, "task", taskId, nextParentId);
    }

    const nextStartDate = parsed.startDate !== undefined ? parsed.startDate : existing.startDate;
    const nextDueDate = parsed.dueDate !== undefined ? parsed.dueDate : existing.dueDate;
    const dateOrder = dateOrderViolation(nextStartDate, nextDueDate);
    if (dateOrder) {
      sendError(res, 400, "invalid_dates", dateOrder);
      return;
    }

    const completeGate = await rejectCompleteIfBlocked(taskId, parsed.state);
    if (completeGate.blocked) {
      sendError(res, 400, "dependency_incomplete", completeGate.message);
      return;
    }

    const persistedState = await resolvePersistedState(db, taskId, existing.state, parsed.state);
    const previousParentId = existing.parentId;
    const stateComment = parsed.stateComment?.trim() ?? "";
    const activitySource = activitySourceFromRequest(req);

    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.tasks)
        .set({
          ...(parsed.title !== undefined ? { title: parsed.title } : {}),
          ...(parsed.description !== undefined ? { description: parsed.description } : {}),
          ...(parsed.dueDate !== undefined ? { dueDate: parsed.dueDate } : {}),
          ...(parsed.startDate !== undefined ? { startDate: parsed.startDate } : {}),
          ...(parsed.estimateHours !== undefined ? { estimateHours: parsed.estimateHours } : {}),
          ...(parsed.color !== undefined ? { color: parsed.color } : {}),
          ...(persistedState !== undefined ? { state: persistedState } : {}),
          ...(parsed.stateManual !== undefined ? { stateManual: parsed.stateManual } : {}),
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
          ...(parsed.assigneeId !== undefined || nextAssigneeId !== existing.assigneeId
            ? { assigneeId: nextAssigneeId }
            : {}),
          updatedAt: new Date(),
          updatedById: actorId,
        })
        .where(eq(schema.tasks.id, taskId))
        .returning();
      if (updated && stateComment && updated.state !== existing.state) {
        await tx.insert(schema.taskActivity).values({
          taskId,
          entityType: "task",
          entityId: taskId,
          kind: "comment",
          body: stateComment,
          createdById: actorId,
          source: activitySource,
        });
      }
      return updated;
    });
    const activityOpts = {
      actorId,
      source: activitySource,
      recordHistory: shouldRecordHistory(req),
    };
    if (row) {
      if (row.phaseId !== existing.phaseId) {
        await syncDescendantPhases(db, taskId, row.phaseId, actorId);
      }
      await recordTaskChanges(db, taskId, existing, row, activityOpts);
      await afterTaskHierarchyChange(db, taskId, previousParentId, activityOpts);
      if (shouldPromoteBlockedDependents(existing.state, row.state)) {
        await promoteBlockedDependents(db, taskId, activityOpts);
      }
      if (shouldBlockReadyDependents(existing.state, row.state)) {
        await blockReadyDependents(db, taskId, activityOpts);
      }
      if (parsed.description !== undefined) {
        await syncMentionLinks(db, {
          srcType: "task",
          srcId: row.id,
          markdown: row.description,
          actorUserId: actorId,
        });
      }
      if (row.projectId != null) {
        await applyTaskGroupAutoTags(db, { projectId: row.projectId, taskId });
      }
      if (row.state === "deleted") await forgetKnowledge("task", row.id);
      else await scheduleKnowledgeIndex("task", row.id);
      reportAssigneeChange(db, {
        actorUserId: actorId,
        previousAssigneeId: existing.assigneeId,
        assigneeId: row.assigneeId,
        entityType: "task",
        entityId: row.id,
        number: row.number,
        title: row.title,
        projectId: row.projectId,
      });
    }
    if (!row) {
      res.json({ data: row });
      return;
    }
    const [fresh] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    const updatedTask = await attachTaskActor(db, fresh ?? row);
    const [data] = await attachAllowedNextStates(db, actorId, [updatedTask]);
    res.json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

standaloneTasksRouter.delete("/:taskId", async (req, res) => {
  try {
    const taskId = idParam.parse(req.params.taskId);
    const [existing] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!existing) {
      sendError(res, 404, "not_found", "Task not found");
      return;
    }
    if (existing.state === "deleted") {
      sendError(res, 400, "already_deleted", "Task is already deleted");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessDualScoped(db, actorId, existing, "write");
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
    const [row] = await db
      .update(schema.tasks)
      .set({
        state: "deleted",
        updatedAt: new Date(),
        updatedById: actorId,
      })
      .where(eq(schema.tasks.id, taskId))
      .returning();
    if (!row) {
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
    if (shouldBlockReadyDependents(existing.state, row.state)) {
      await blockReadyDependents(db, taskId, activityOpts);
    }
    await forgetKnowledge("task", taskId);
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
