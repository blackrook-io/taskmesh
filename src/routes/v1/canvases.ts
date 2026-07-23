import { and, asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { parseRouteId } from "../../lib/routeParams.js";

const createBody = z.object({
  title: z.string().min(1).max(500).optional(),
  document: z.record(z.string(), z.unknown()).optional(),
});

const patchBody = z.object({
  title: z.string().min(1).max(500).optional(),
  document: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
});

const reorderBody = z.object({
  orderedCanvasIds: z.array(z.number().int().positive()).min(1),
});

export const canvasesRouter = Router({ mergeParams: true });

async function requireProject(projectId: number) {
  const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  return proj ?? null;
}

async function requireCanvas(projectId: number, canvasId: number) {
  const [row] = await db.select().from(schema.canvases).where(eq(schema.canvases.id, canvasId));
  if (!row || row.projectId !== projectId) return null;
  return row;
}

canvasesRouter.get("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const rows = await db
      .select({
        id: schema.canvases.id,
        projectId: schema.canvases.projectId,
        title: schema.canvases.title,
        sortOrder: schema.canvases.sortOrder,
        createdAt: schema.canvases.createdAt,
        updatedAt: schema.canvases.updatedAt,
      })
      .from(schema.canvases)
      .where(eq(schema.canvases.projectId, projectId))
      .orderBy(asc(schema.canvases.sortOrder), asc(schema.canvases.id));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

canvasesRouter.post("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const parsed = createBody.parse(req.body);
    const existing = await db
      .select({ m: schema.canvases.sortOrder })
      .from(schema.canvases)
      .where(eq(schema.canvases.projectId, projectId));
    const nextSort = existing.length ? Math.max(...existing.map((r) => r.m)) + 1 : 0;
    const [row] = await db
      .insert(schema.canvases)
      .values({
        projectId,
        title: parsed.title?.trim() || "Untitled canvas",
        sortOrder: nextSort,
        document: parsed.document ?? {},
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create canvas");
      return;
    }
    res.status(201).json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

canvasesRouter.patch("/reorder", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    if (!(await requireProject(projectId))) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const { orderedCanvasIds } = reorderBody.parse(req.body);
    const existing = await db
      .select({ id: schema.canvases.id })
      .from(schema.canvases)
      .where(eq(schema.canvases.projectId, projectId));
    const allowed = new Set(existing.map((r) => r.id));
    if (
      orderedCanvasIds.length !== allowed.size ||
      orderedCanvasIds.some((id) => !allowed.has(id))
    ) {
      sendError(res, 400, "invalid_reorder", "orderedCanvasIds must list every canvas exactly once");
      return;
    }
    for (let i = 0; i < orderedCanvasIds.length; i++) {
      const id = orderedCanvasIds[i]!;
      await db
        .update(schema.canvases)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(schema.canvases.id, id));
    }
    const rows = await db
      .select({
        id: schema.canvases.id,
        projectId: schema.canvases.projectId,
        title: schema.canvases.title,
        sortOrder: schema.canvases.sortOrder,
        createdAt: schema.canvases.createdAt,
        updatedAt: schema.canvases.updatedAt,
      })
      .from(schema.canvases)
      .where(eq(schema.canvases.projectId, projectId))
      .orderBy(asc(schema.canvases.sortOrder), asc(schema.canvases.id));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

canvasesRouter.get("/:canvasId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const canvasId = parseRouteId(req, "canvasId");
    const row = await requireCanvas(projectId, canvasId);
    if (!row) {
      sendError(res, 404, "not_found", "Canvas not found");
      return;
    }
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

canvasesRouter.patch("/:canvasId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const canvasId = parseRouteId(req, "canvasId");
    const existing = await requireCanvas(projectId, canvasId);
    if (!existing) {
      sendError(res, 404, "not_found", "Canvas not found");
      return;
    }
    const parsed = patchBody.parse(req.body);
    if (
      parsed.title === undefined &&
      parsed.document === undefined &&
      parsed.sortOrder === undefined
    ) {
      sendError(res, 400, "empty_patch", "Provide title, document, and/or sortOrder");
      return;
    }
    const [row] = await db
      .update(schema.canvases)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.document !== undefined ? { document: parsed.document } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.canvases.id, canvasId))
      .returning();

    if (parsed.title !== undefined) {
      await db
        .update(schema.wikiNodes)
        .set({ title: parsed.title, updatedAt: new Date() })
        .where(
          and(
            eq(schema.wikiNodes.projectId, projectId),
            eq(schema.wikiNodes.entityType, "canvas"),
            eq(schema.wikiNodes.entityId, canvasId),
          ),
        );
    }

    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

canvasesRouter.delete("/:canvasId", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const canvasId = parseRouteId(req, "canvasId");
    const existing = await requireCanvas(projectId, canvasId);
    if (!existing) {
      sendError(res, 404, "not_found", "Canvas not found");
      return;
    }
    await db
      .delete(schema.wikiNodes)
      .where(
        and(
          eq(schema.wikiNodes.projectId, projectId),
          eq(schema.wikiNodes.entityType, "canvas"),
          eq(schema.wikiNodes.entityId, canvasId),
        ),
      );
    await db.delete(schema.canvases).where(eq(schema.canvases.id, canvasId));
    res.status(204).send();
  } catch (err) {
    handleRouteError(res, err);
  }
});
