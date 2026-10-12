import type { Router } from "express";
import { db } from "../../db/client.js";
import { handleRouteError } from "../../lib/httpError.js";
import { aiProviderPatchSchema, listAiProvidersForAdmin, patchAiProvider } from "../../services/assistant/aiProviderAdmin.js";

export function registerAiProviderAdminRoutes(adminRouter: Router): void {
  adminRouter.get("/ai-providers", async (_req, res) => {
    try {
      res.json({ data: { plugins: await listAiProvidersForAdmin(db) } });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  adminRouter.patch("/ai-providers", async (req, res) => {
    try {
      const parsed = aiProviderPatchSchema.parse(req.body ?? {});
      const row = await patchAiProvider(db, parsed);
      res.locals.logMessage = `AI provider ${row.id} ${row.enabled ? "enabled" : "disabled"}`;
      res.json({ data: row });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
}
