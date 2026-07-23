import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { parseRouteId } from "../../lib/routeParams.js";
import { ensureDefaultPhase } from "../../services/phases.js";

const taskBody = z.object({
  title: z.string().min(1).max(2000),
  notes: z.string().max(50_000).optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  color: z.string().max(64).optional().nullable(),
  phaseId: z.number().int().positive().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

const taskPatch = z.object({
  title: z.string().min(1).max(2000).optional(),
  notes: z.string().max(50_000).optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  color: z.string().max(64).optional().nullable(),
  phaseId: z.number().int().positive().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

const reorderBody = z.object({
  orderedTaskIds: z.array(z.number().int().positive()).min(1),
});

export const tasksRouter = Router({ mergeParams: true });

tasksRouter.get("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    await ensureDefaultPhase(db, projectId);
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId))
      .orderBy(asc(schema.tasks.sortOrder), asc(schema.tasks.id));
    res.json({ data: rows });
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
    const defaultPhaseId = await ensureDefaultPhase(db, projectId);

    let phaseId = parsed.phaseId ?? defaultPhaseId;
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

    const maxSort = await db
      .select({ m: schema.tasks.sortOrder })
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId))
      .orderBy(asc(schema.tasks.sortOrder));

    const nextSort =
      parsed.sortOrder ??
      (maxSort.length ? Math.max(...maxSort.map((r) => r.m)) + 1 : 0);

    const [row] = await db
      .insert(schema.tasks)
      .values({
        projectId,
        phaseId,
        title: parsed.title,
        notes: parsed.notes ?? null,
        dueAt: parsed.dueAt ? new Date(parsed.dueAt) : null,
        color: parsed.color ?? null,
        sortOrder: nextSort,
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

tasksRouter.patch("/reorder", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const { orderedTaskIds } = reorderBody.parse(req.body);

    const existing = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId));
    const allowed = new Set(existing.map((e) => e.id));
    if (orderedTaskIds.length !== allowed.size) {
      sendError(res, 400, "invalid_reorder", "orderedTaskIds must list every task in the project exactly once");
      return;
    }
    const seen = new Set<number>();
    for (const tid of orderedTaskIds) {
      if (!allowed.has(tid)) {
        sendError(res, 400, "invalid_task", `Task ${tid} is not in this project`);
        return;
      }
      if (seen.has(tid)) {
        sendError(res, 400, "invalid_reorder", "Duplicate task id in orderedTaskIds");
        return;
      }
      seen.add(tid);
    }

    for (let i = 0; i < orderedTaskIds.length; i++) {
      const tid = orderedTaskIds[i];
      if (tid === undefined) continue;
      await db
        .update(schema.tasks)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(schema.tasks.id, tid));
    }

    const rows = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId))
      .orderBy(asc(schema.tasks.sortOrder), asc(schema.tasks.id));
    res.json({ data: rows });
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
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

tasksRouter.patch("/:taskId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const taskId = parseRouteId(req, "taskId");
    const parsed = taskPatch.parse(req.body);
    const [existing] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!existing || existing.projectId !== projectId) {
      sendError(res, 404, "not_found", "Task not found");
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

    const dueAt =
      parsed.dueAt === undefined
        ? undefined
        : parsed.dueAt === null
          ? null
          : new Date(parsed.dueAt);

    const [row] = await db
      .update(schema.tasks)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
        ...(dueAt !== undefined ? { dueAt } : {}),
        ...(parsed.color !== undefined ? { color: parsed.color } : {}),
        ...(parsed.phaseId !== undefined ? { phaseId: parsed.phaseId } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, taskId))
      .returning();
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

tasksRouter.delete("/:taskId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const taskId = parseRouteId(req, "taskId");
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
