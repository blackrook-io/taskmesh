import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { parseRouteId } from "../../lib/routeParams.js";
import {
  isProjectModuleKey,
  listProjectModules,
  PROJECT_MODULE_KEYS,
  setModuleEnabled,
} from "../../services/projectModules.js";

const modulePatch = z.object({
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const reorderBody = z.object({
  orderedKeys: z.array(z.enum(PROJECT_MODULE_KEYS)).length(PROJECT_MODULE_KEYS.length),
});

export const modulesRouter = Router({ mergeParams: true });

modulesRouter.get("/", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    res.json({ data: await listProjectModules(db, projectId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

modulesRouter.patch("/reorder", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const { orderedKeys } = reorderBody.parse(req.body);
    const unique = new Set(orderedKeys);
    if (unique.size !== PROJECT_MODULE_KEYS.length) {
      sendError(res, 400, "invalid_reorder", "orderedKeys must list every module exactly once");
      return;
    }
    for (let i = 0; i < orderedKeys.length; i++) {
      const key = orderedKeys[i];
      if (key === undefined) continue;
      await db
        .update(schema.projectModules)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(
          and(
            eq(schema.projectModules.projectId, projectId),
            eq(schema.projectModules.moduleKey, key),
          ),
        );
    }
    res.json({ data: await listProjectModules(db, projectId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

modulesRouter.patch("/:moduleKey", async (req, res) => {
  try {
    const projectId = parseRouteId(req, "projectId");
    const moduleKeyRaw = String(req.params.moduleKey ?? "");
    if (!isProjectModuleKey(moduleKeyRaw)) {
      sendError(res, 400, "invalid_module", `Unknown module: ${moduleKeyRaw}`);
      return;
    }
    const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!proj) {
      sendError(res, 404, "not_found", "Project not found");
      return;
    }
    const parsed = modulePatch.parse(req.body);
    if (parsed.enabled === undefined && parsed.sortOrder === undefined) {
      sendError(res, 400, "validation_error", "Provide enabled and/or sortOrder");
      return;
    }
    if (parsed.enabled !== undefined) {
      await setModuleEnabled(db, projectId, moduleKeyRaw, parsed.enabled);
    }
    if (parsed.sortOrder !== undefined) {
      await db
        .update(schema.projectModules)
        .set({ sortOrder: parsed.sortOrder, updatedAt: new Date() })
        .where(
          and(
            eq(schema.projectModules.projectId, projectId),
            eq(schema.projectModules.moduleKey, moduleKeyRaw),
          ),
        );
    }
    const rows = await listProjectModules(db, projectId);
    const row = rows.find((r) => r.moduleKey === moduleKeyRaw);
    res.json({ data: row });
  } catch (err) {
    handleRouteError(res, err);
  }
});
