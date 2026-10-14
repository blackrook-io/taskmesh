import { asc, eq } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { activitySourceFromRequest } from "../../lib/activityRequest.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { optionalMarkdown, optionalPlainTitle, plainTitle } from "../../lib/markdownFields.js";
import { hasDefinedKeys } from "../../lib/immutableFields.js";
import { allocateProjectNumber } from "../../services/entityNumbers.js";
import {
  assertCanAccessProject,
  projectAccessListFilter,
  projectWriteListFilter,
  resolveProjectActorRole,
} from "../../services/ownership.js";
import { nextProjectSortOrder } from "../../services/projectSortOrder.js";
import { ensureProjectModules } from "../../services/projectModules.js";
import { forgetKnowledge, scheduleKnowledgeIndex, scheduleProjectKnowledgeIndex } from "../../services/knowledge/schedule.js";
import { userHasAdministrator } from "../../services/roles.js";
import { attachMemberTaskIds } from "../../services/taskGroupMembers.js";
import {
  recordProjectAiAccessChange,
  recordProjectAiLocalOnlyChange,
  recordProjectStatusChange,
} from "../../services/entityActivity.js";
import {
  aiAccessWiderThan,
  aiLocalOnlyWiderThanCeiling,
  getAiProjectAccessCeiling,
  getAiProjectLocalOnlyCeiling,
  isAiAccess,
  projectAiAccessFields,
  projectAiLocalOnlyFields,
} from "../../services/assistant/projectAiAccess.js";
import { getCurrentUserId } from "../../services/users.js";
import { listAssignableUsers } from "../../services/assignees.js";
import {
  getUserOverviewPrefs,
  putUserOverviewPrefs,
  resetUserOverviewPrefs,
  getProjectOverviewDefault,
  putProjectOverviewDefault,
} from "../../services/overviewPrefs.js";
import type { OverviewPanelInstance } from "../../db/schema.js";
import { documentsRouter } from "./documents.js";
import { modulesRouter } from "./modules.js";
import { boardsRouter } from "./boards.js";
import { canvasesRouter } from "./canvases.js";
import { groupsRouter } from "./groups.js";
import { phasesRouter } from "./phases.js";
import { projectUsersRouter } from "./projectUsers.js";
import { tasksRouter } from "./tasks.js";
import { wikiRouter } from "./wiki.js";
import { NOT_ADMINISTRATOR_MESSAGE } from "../../middleware/requireAdministrator.js";

const projectStatus = z.enum(["idea", "active", "paused", "done"]);

const aiAccessValue = z.enum(["full", "read_only", "excluded"]);

const projectBody = z.object({
  name: plainTitle(500),
  description: optionalMarkdown(500_000),
  status: projectStatus.optional(),
});

const projectPatch = z.object({
  name: optionalPlainTitle(500),
  description: optionalMarkdown(500_000),
  status: projectStatus.optional(),
  aiAccess: aiAccessValue.optional(),
  aiLocalOnly: z.boolean().optional(),
  aiInstructions: optionalMarkdown(8_000),
});

const overviewPanelInstanceSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.string().min(1).max(80),
  limit: z.union([z.literal(5), z.literal(10), z.literal(20)]),
  days: z.number().int().min(1).max(365).optional(),
});

const overviewPrefsPutSchema = z.union([
  z.object({
    reset: z.literal(true),
  }),
  z.object({
    layout: z.array(overviewPanelInstanceSchema),
  }),
]);

const overviewDefaultPutSchema = z.object({
  layout: z.array(overviewPanelInstanceSchema),
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
    const scope = projectAccessListFilter(db, actorId, isAdmin);
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
    const aiAccess = await getAiProjectAccessCeiling(db);
    const [row] = await db
      .insert(schema.projects)
      .values({
        number,
        name: parsed.name,
        description: parsed.description ?? null,
        status: parsed.status ?? "idea",
        sortOrder,
        ownerId,
        aiAccess,
      })
      .returning();
    if (!row) {
      sendError(res, 500, "insert_failed", "Could not create project");
      return;
    }
    await ensureProjectModules(db, row.id);
    await scheduleKnowledgeIndex("project", row.id);
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
    const scope = projectAccessListFilter(db, actorId, isAdmin);
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
          : "orderedProjectIds must list every accessible project exactly once",
      );
      return;
    }
    // `sortOrder` is a global column, so a Viewer must not be able to move a
    // project for everyone. Validation still spans every accessible project
    // (the nav sends them all), but only write-accessible rows are updated
    // (T0143).
    const writeScope = projectWriteListFilter(db, actorId, isAdmin);
    const writable = writeScope
      ? new Set(
          (
            await db
              .select({ id: schema.projects.id })
              .from(schema.projects)
              .where(writeScope)
          ).map((r) => r.id),
        )
      : allowed;
    for (let i = 0; i < orderedProjectIds.length; i++) {
      const id = orderedProjectIds[i]!;
      if (!writable.has(id)) continue;
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
    const myRole = await resolveProjectActorRole(db, actorId, row);
    const access = await projectAiAccessFields(db, row.aiAccess);
    const localOnly = await projectAiLocalOnlyFields(db, row.aiLocalOnly);
    res.json({
      data: {
        ...row,
        ...access,
        ...localOnly,
        myRole,
        canWrite: myRole != null && myRole !== "viewer",
        canManageSettings:
          myRole === "admin" || myRole === "owner" || myRole === "manager",
      },
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.patch("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const parsed = projectPatch.parse(req.body);
    if (
      !hasDefinedKeys(parsed, [
        "name",
        "description",
        "status",
        "aiAccess",
        "aiLocalOnly",
        "aiInstructions",
      ])
    ) {
      sendError(res, 400, "empty_patch", "Provide name, description, status, and/or AI settings");
      return;
    }
    const actorId = await getCurrentUserId(db);
    if (parsed.aiAccess !== undefined) {
      const ceiling = await getAiProjectAccessCeiling(db);
      if (!isAiAccess(parsed.aiAccess) || aiAccessWiderThan(parsed.aiAccess, ceiling)) {
        sendError(
          res,
          400,
          "ai_access_wider_than_ceiling",
          "Project AI access cannot be wider than the instance default",
        );
        return;
      }
    }
    if (parsed.aiLocalOnly !== undefined) {
      const ceiling = await getAiProjectLocalOnlyCeiling(db);
      if (aiLocalOnlyWiderThanCeiling(parsed.aiLocalOnly, ceiling)) {
        sendError(
          res,
          400,
          "ai_local_only_wider_than_ceiling",
          "This project cannot use a cloud model while the instance requires local models",
        );
        return;
      }
    }
    // Description and AI settings are Owner/Manager/Admin only; name/status remain write-level.
    const needsSettings =
      parsed.description !== undefined ||
      parsed.aiAccess !== undefined ||
      parsed.aiLocalOnly !== undefined ||
      parsed.aiInstructions !== undefined;
    const existing = needsSettings
      ? await assertCanAccessProject(db, actorId, id, "settings")
      : await assertCanAccessProject(db, actorId, id, "write");
    const [row] = await db
      .update(schema.projects)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        ...(parsed.aiAccess !== undefined ? { aiAccess: parsed.aiAccess } : {}),
        ...(parsed.aiLocalOnly !== undefined ? { aiLocalOnly: parsed.aiLocalOnly } : {}),
        ...(parsed.aiInstructions !== undefined
          ? { aiInstructions: parsed.aiInstructions?.trim() ? parsed.aiInstructions.trim() : null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, id))
      .returning();
    if (parsed.status !== undefined) {
      await recordProjectStatusChange(
        db,
        id,
        existing.status,
        parsed.status,
        actorId,
        activitySourceFromRequest(req),
      );
    }
    if (parsed.aiAccess !== undefined) {
      await recordProjectAiAccessChange(
        db,
        id,
        existing.aiAccess,
        parsed.aiAccess,
        actorId,
        activitySourceFromRequest(req),
      );
    }
    if (parsed.aiAccess !== undefined) await scheduleProjectKnowledgeIndex(id);
    else if (row) await scheduleKnowledgeIndex("project", id);
    if (parsed.aiLocalOnly !== undefined) {
      await recordProjectAiLocalOnlyChange(
        db,
        id,
        existing.aiLocalOnly,
        parsed.aiLocalOnly,
        actorId,
        activitySourceFromRequest(req),
      );
    }
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.get("/:id/overview-prefs", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const actorId = await getCurrentUserId(db);
    await assertCanAccessProject(db, actorId, id);
    res.json({ data: await getUserOverviewPrefs(db, actorId, id) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.put("/:id/overview-prefs", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const parsed = overviewPrefsPutSchema.parse(req.body);
    const actorId = await getCurrentUserId(db);
    await assertCanAccessProject(db, actorId, id);
    if ("reset" in parsed && parsed.reset) {
      res.json({ data: await resetUserOverviewPrefs(db, actorId, id) });
      return;
    }
    res.json({
      data: await putUserOverviewPrefs(
        db,
        actorId,
        id,
        (parsed as { layout: OverviewPanelInstance[] }).layout,
      ),
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.get("/:id/overview-default", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const actorId = await getCurrentUserId(db);
    await assertCanAccessProject(db, actorId, id);
    res.json({ data: { layout: await getProjectOverviewDefault(db, id) } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.put("/:id/overview-default", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const parsed = overviewDefaultPutSchema.parse(req.body);
    const actorId = await getCurrentUserId(db);
    await assertCanAccessProject(db, actorId, id, "settings");
    const layout = await putProjectOverviewDefault(db, id, parsed.layout, actorId);
    res.json({ data: { layout } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

projectsRouter.delete("/:id", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const actorId = await getCurrentUserId(db);
    const isAdmin = await userHasAdministrator(db, actorId);
    if (!isAdmin) {
      sendError(res, 403, "not_administrator", NOT_ADMINISTRATOR_MESSAGE);
      return;
    }
    await assertCanAccessProject(db, actorId, id, "write");
    const deleted = await db
      .delete(schema.projects)
      .where(eq(schema.projects.id, id))
      .returning({ id: schema.projects.id });
    if (deleted.length === 0) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    await forgetKnowledge("project", id);
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

/** Assignable users for T0117 (Owner + Managers + Members; not Viewers). */
projectsRouter.get("/:id/assignable-users", async (req, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const actorId = await getCurrentUserId(db);
    await assertCanAccessProject(db, actorId, id);
    const users = await listAssignableUsers(db, id);
    res.json({ data: users });
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
    const method = req.method.toUpperCase();
    const level =
      method === "GET" || method === "HEAD" || method === "OPTIONS" ? "read" : "write";
    await assertCanAccessProject(db, actorId, projectId, level);
    next();
  } catch (err) {
    handleRouteError(res, err);
  }
}

/** Phases mutations are Settings (Admin/Owner/Manager); GET list is on /projects/:id/phases. */
async function ensureNestedProjectSettings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const projectId = idParam.parse(req.params.projectId);
    const actorId = await getCurrentUserId(db);
    await assertCanAccessProject(db, actorId, projectId, "settings");
    next();
  } catch (err) {
    handleRouteError(res, err);
  }
}

projectsRouter.use("/:projectId/groups", ensureNestedProjectAccess, groupsRouter);
projectsRouter.use("/:projectId/phases", ensureNestedProjectSettings, phasesRouter);
projectsRouter.use("/:projectId/tasks", ensureNestedProjectAccess, tasksRouter);
projectsRouter.use("/:projectId/documents", ensureNestedProjectAccess, documentsRouter);
projectsRouter.use("/:projectId/modules", ensureNestedProjectAccess, modulesRouter);
projectsRouter.use("/:projectId/boards", ensureNestedProjectAccess, boardsRouter);
projectsRouter.use("/:projectId/wiki", ensureNestedProjectAccess, wikiRouter);
projectsRouter.use("/:projectId/canvases", ensureNestedProjectAccess, canvasesRouter);
projectsRouter.use("/:projectId/users", projectUsersRouter);
