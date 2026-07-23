import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { parseRouteId } from "../../lib/routeParams.js";
import { ensureDefaultPhase } from "../../services/phases.js";

const phaseBody = z.object({
  name: z.string().min(1).max(200),
  sortOrder: z.number().int().optional(),
});

const phasePatch = z.object({
  name: z.string().min(1).max(200).optional(),
  sortOrder: z.number().int().optional(),
});

const reorderBody = z.object({
  orderedPhaseIds: z.array(z.number().int().positive()).min(1),
});

export const phasesRouter = Router({ mergeParams: true });

async function requireProject(projectId: number) {
  const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  return proj ?? null;
}

phasesRouter.post("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    await ensureDefaultPhase(db, projectId);
    const parsed = phaseBody.parse(req.body);
    const existing = await db
      .select({ m: schema.projectPhases.sortOrder })
      .from(schema.projectPhases)
      .where(eq(schema.projectPhases.projectId, projectId));
    const nextSort =
      parsed.sortOrder ?? (existing.length ? Math.max(...existing.map((r) => r.m)) + 1 : 0);
    const [row] = await db
      .insert(schema.projectPhases)
      .values({ projectId, name: parsed.name, sortOrder: nextSort })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create phase");
      return;
    }
    res.status(201).json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

phasesRouter.patch("/reorder", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const { orderedPhaseIds } = reorderBody.parse(req.body);
    const existing = await db
      .select({ id: schema.projectPhases.id })
      .from(schema.projectPhases)
      .where(eq(schema.projectPhases.projectId, projectId));
    const allowed = new Set(existing.map((e) => e.id));
    if (orderedPhaseIds.length !== allowed.size) {
      sendError(res, 400, "invalid_reorder", "orderedPhaseIds must list every phase exactly once");
      return;
    }
    const seen = new Set<number>();
    for (const id of orderedPhaseIds) {
      if (!allowed.has(id) || seen.has(id)) {
        sendError(res, 400, "invalid_reorder", "Invalid phase id list");
        return;
      }
      seen.add(id);
    }
    for (let i = 0; i < orderedPhaseIds.length; i++) {
      const id = orderedPhaseIds[i];
      if (id === undefined) continue;
      await db
        .update(schema.projectPhases)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(schema.projectPhases.id, id));
    }
    const rows = await db
      .select()
      .from(schema.projectPhases)
      .where(eq(schema.projectPhases.projectId, projectId))
      .orderBy(asc(schema.projectPhases.sortOrder));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

phasesRouter.patch("/:phaseId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const phaseId = parseRouteId(req, "phaseId");
    const parsed = phasePatch.parse(req.body);
    const [existing] = await db
      .select()
      .from(schema.projectPhases)
      .where(eq(schema.projectPhases.id, phaseId));
    if (!existing || existing.projectId !== projectId) {
      sendError(res, 404, "not_found", "Phase not found");
      return;
    }
    const [row] = await db
      .update(schema.projectPhases)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.projectPhases.id, phaseId))
      .returning();
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

phasesRouter.delete("/:phaseId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const phaseId = parseRouteId(req, "phaseId");
    const phases = await db
      .select()
      .from(schema.projectPhases)
      .where(eq(schema.projectPhases.projectId, projectId))
      .orderBy(asc(schema.projectPhases.sortOrder));
    const existing = phases.find((p) => p.id === phaseId);
    if (!existing) {
      sendError(res, 404, "not_found", "Phase not found");
      return;
    }
    if (phases.length <= 1) {
      sendError(res, 400, "last_phase", "Cannot delete the only phase");
      return;
    }
    const fallback = phases.find((p) => p.id !== phaseId);
    if (!fallback) {
      sendError(res, 500, "internal_error", "No fallback phase");
      return;
    }
    await db
      .update(schema.tasks)
      .set({ phaseId: fallback.id, updatedAt: new Date() })
      .where(eq(schema.tasks.phaseId, phaseId));
    await db.delete(schema.projectPhases).where(eq(schema.projectPhases.id, phaseId));
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});
