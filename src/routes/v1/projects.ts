import { asc, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { ensureDefaultPhase } from "../../services/phases.js";
import { ensureProjectModules } from "../../services/projectModules.js";
import { documentsRouter } from "./documents.js";
import { modulesRouter } from "./modules.js";
import { boardsRouter } from "./boards.js";
import { phasesRouter } from "./phases.js";
import { tasksRouter } from "./tasks.js";
import { wikiRouter } from "./wiki.js";

const projectStatus = z.enum(["idea", "active", "paused", "done"]);

const projectBody = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(500_000).optional().nullable(),
  status: projectStatus.optional(),
});

const projectPatch = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(500_000).optional().nullable(),
  status: projectStatus.optional(),
});

const idParam = z.coerce.number().int().positive();

export const projectsRouter = Router();

projectsRouter.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(schema.projects).orderBy(desc(schema.projects.updatedAt));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.post("/", async (req, res) => {
  try {
    const parsed = projectBody.parse(req.body);
    const [row] = await db
      .insert(schema.projects)
      .values({
        name: parsed.name,
        description: parsed.description ?? null,
        status: parsed.status ?? "idea",
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create project");
      return;
    }
    await ensureDefaultPhase(db, row.id);
    await ensureProjectModules(db, row.id);
    res.status(201).json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.get("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
    if (!row) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.patch("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const parsed = projectPatch.parse(req.body);
    const [existing] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
    if (!existing) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const [row] = await db
      .update(schema.projects)
      .set({
        ...parsed,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, id))
      .returning();
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.delete("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const deleted = await db
      .delete(schema.projects)
      .where(eq(schema.projects.id, id))
      .returning({ id: schema.projects.id });
    if (deleted.length === 0) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    res.status(204).end();
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.get("/:id/phases", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    await ensureDefaultPhase(db, id);
    const rows = await db
      .select()
      .from(schema.projectPhases)
      .where(eq(schema.projectPhases.projectId, id))
      .orderBy(asc(schema.projectPhases.sortOrder));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.use("/:projectId/phases", phasesRouter);
projectsRouter.use("/:projectId/tasks", tasksRouter);
projectsRouter.use("/:projectId/documents", documentsRouter);
projectsRouter.use("/:projectId/modules", modulesRouter);
projectsRouter.use("/:projectId/boards", boardsRouter);
projectsRouter.use("/:projectId/wiki", wikiRouter);
