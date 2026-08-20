import { and, desc, eq, isNull, ne } from "drizzle-orm";
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
import {
  dueDateSchema,
  selectableTaskStateSchema,
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
import {
  afterTaskHierarchyChange,
  resolvePersistedState,
} from "../../services/taskPending.js";
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

const idParam = z.coerce.number().int().positive();

const createBody = z.object({
  title: z.string().min(1).max(2000),
  description: z.string().max(50_000).optional().nullable(),
  dueDate: dueDateSchema,
  color: z.string().max(64).optional().nullable(),
  state: selectableTaskStateSchema.optional(),
  priority: taskPrioritySchema.optional(),
  parentId: z.number().int().positive().optional().nullable(),
});

const patchBody = z.object({
  title: z.string().min(1).max(2000).optional(),
  description: z.string().max(50_000).optional().nullable(),
  dueDate: dueDateSchema,
  color: z.string().max(64).optional().nullable(),
  state: selectableTaskStateSchema.optional(),
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
    const filters = [];
    if (parsed.projectId === "null") {
      filters.push(isNull(schema.tasks.projectId));
    } else if (typeof parsed.projectId === "number") {
      filters.push(eq(schema.tasks.projectId, parsed.projectId));
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
    res.json({ data: await attachTaskActors(db, rows) });
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
    res.json({ data: await attachTaskActor(db, row) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

standaloneTasksRouter.post("/", async (req, res) => {
  try {
    const parsed = createBody.parse(req.body);
    const actorId = await getCurrentUserId(db);
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
    res.status(201).json({ data: await attachTaskActor(db, row) });
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

    if (
      !hasDefinedKeys(parsed, [
        "title",
        "description",
        "dueDate",
        "color",
        "state",
        "priority",
        "parentId",
        "projectId",
        "phaseId",
      ])
    ) {
      sendError(res, 400, "empty_patch", "No updatable fields provided");
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
        // T0075: list groups are not membership; clear leftover phaseId on project change.
        if (parsed.phaseId === undefined) {
          nextPhaseId = null;
        }
      }
      // Parent must share project scope; clear when project changes unless client set parent.
      if (parsed.parentId === undefined) {
        nextParentId = null;
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
        ...(parsed.dueDate !== undefined ? { dueDate: parsed.dueDate } : {}),
        ...(parsed.color !== undefined ? { color: parsed.color } : {}),
        ...(persistedState !== undefined ? { state: persistedState } : {}),
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
        updatedById: actorId,
      })
      .where(eq(schema.tasks.id, taskId))
      .returning();
    const activityOpts = {
      actorId,
      source: activitySourceFromRequest(req),
      recordHistory: shouldRecordHistory(req),
    };
    if (row) {
      await recordTaskChanges(db, taskId, existing, row, activityOpts);
      await afterTaskHierarchyChange(db, taskId, previousParentId, activityOpts);
    }
    res.json({ data: row ? await attachTaskActor(db, row) : row });
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
    if (!row) {
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
