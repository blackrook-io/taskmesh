import { asc, eq } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { optionalMarkdown, optionalPlainTitle, plainTitle } from "../../lib/markdownFields.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { allocateProjectNumber } from "../../services/entityNumbers.js";
import {
  assertCanAccessProject,
  ownerScope,
} from "../../services/ownership.js";
import { nextProjectSortOrder } from "../../services/projectSortOrder.js";
import { ensureProjectModules } from "../../services/projectModules.js";
import { userHasAdministrator } from "../../services/roles.js";
import { attachMemberTaskIds } from "../../services/taskGroupMembers.js";
import { getCurrentUserId } from "../../services/users.js";
import { documentsRouter } from "./documents.js";
import { modulesRouter } from "./modules.js";
import { boardsRouter } from "./boards.js";
import { canvasesRouter } from "./canvases.js";
import { groupsRouter } from "./groups.js";
import { phasesRouter } from "./phases.js";
import { tasksRouter } from "./tasks.js";
import { wikiRouter } from "./wiki.js";

const projectStatus = z.enum(["idea", "active", "paused", "done"]);

const projectBody = z.object({
  name: plainTitle(500),
  description: optionalMarkdown(500_000),
  status: projectStatus.optional(),
});

const projectPatch = z.object({
  name: optionalPlainTitle(500),
  description: optionalMarkdown(500_000),
  status: projectStatus.optional(),
});

const reorderBody = z.object({
  orderedProjectIds: z.array(z.number().int().positive()),
});

const idParam = z.coerce.number().int().positive();

export const projectsRouter = Router();

projectsRouter.get("/", async (_req, res) => {
  try {
    const actorId = await getCurrentUserId(db);
    const isAdmin = await userHasAdministrator(db, actorId);
    const scope = ownerScope(schema.projects.ownerId, actorId, isAdmin);
    const rows = await db
      .select()
      .from(schema.projects)
      .where(scope)
      .orderBy(asc(schema.projects.sortOrder), asc(schema.projects.id));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.post("/", async (req, res) => {
  try {
    const parsed = projectBody.parse(req.body);
    const number = await allocateProjectNumber(db);
    const sortOrder = await nextProjectSortOrder(db);
    const ownerId = await getCurrentUserId(db);
    const [row] = await db
      .insert(schema.projects)
      .values({
        number,
        name: parsed.name,
        description: parsed.description ?? null,
        status: parsed.status ?? "idea",
        sortOrder,
        ownerId,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create project");
      return;
    }
    await ensureProjectModules(db, row.id);
    res.status(201).json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.patch("/reorder", async (req, res) => {
  try {
    const { orderedProjectIds } = reorderBody.parse(req.body);
    const actorId = await getCurrentUserId(db);
    const isAdmin = await userHasAdministrator(db, actorId);
    const scope = ownerScope(schema.projects.ownerId, actorId, isAdmin);
    const existing = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(scope);
    const allowed = new Set(existing.map((r) => r.id));
    if (
      orderedProjectIds.length !== allowed.size ||
      orderedProjectIds.some((id) => !allowed.has(id))
    ) {
      sendError(
        res,
        400,
        "invalid_reorder",
        isAdmin
          ? "orderedProjectIds must list every project exactly once"
          : "orderedProjectIds must list every project you own exactly once",
      );
      return;
    }
    for (let i = 0; i < orderedProjectIds.length; i++) {
      const id = orderedProjectIds[i]!;
      await db
        .update(schema.projects)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(schema.projects.id, id));
    }
    const rows = await db
      .select()
      .from(schema.projects)
      .where(scope)
      .orderBy(asc(schema.projects.sortOrder), asc(schema.projects.id));
    res.json({ data: rows });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.get("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const actorId = await getCurrentUserId(db);
    const row = await assertCanAccessProject(db, actorId, id);
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.patch("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const parsed = projectPatch.parse(req.body);
    if (!hasDefinedKeys(parsed, ["name", "description", "status"])) {
      sendError(res, 400, "empty_patch", "Provide name, description, and/or status");
      return;
    }
    const actorId = await getCurrentUserId(db);
    await assertCanAccessProject(db, actorId, id);
    const [row] = await db
      .update(schema.projects)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
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
    const actorId = await getCurrentUserId(db);
    await assertCanAccessProject(db, actorId, id);
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

projectsRouter.get("/:id/groups", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const actorId = await getCurrentUserId(db);
    await assertCanAccessProject(db, actorId, id);
    const rows = await db
      .select()
      .from(schema.taskGroups)
      .where(eq(schema.taskGroups.projectId, id))
      .orderBy(asc(schema.taskGroups.sortOrder));
    res.json({ data: await attachMemberTaskIds(db, rows) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.get("/:id/phases", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const actorId = await getCurrentUserId(db);
    await assertCanAccessProject(db, actorId, id);
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

async function ensureNestedProjectAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const projectId = idParam.parse(req.params.projectId);
    const actorId = await getCurrentUserId(db);
    await assertCanAccessProject(db, actorId, projectId);
    next();
  } catch (err) {
    handleRouteError(res, err);
  }
}

projectsRouter.use("/:projectId/groups", ensureNestedProjectAccess, groupsRouter);
projectsRouter.use("/:projectId/phases", ensureNestedProjectAccess, phasesRouter);
projectsRouter.use("/:projectId/tasks", ensureNestedProjectAccess, tasksRouter);
projectsRouter.use("/:projectId/documents", ensureNestedProjectAccess, documentsRouter);
projectsRouter.use("/:projectId/modules", ensureNestedProjectAccess, modulesRouter);
projectsRouter.use("/:projectId/boards", ensureNestedProjectAccess, boardsRouter);
projectsRouter.use("/:projectId/wiki", ensureNestedProjectAccess, wikiRouter);
projectsRouter.use("/:projectId/canvases", ensureNestedProjectAccess, canvasesRouter);
