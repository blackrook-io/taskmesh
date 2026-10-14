import type { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { handleRouteError } from "../../lib/httpError.js";
import { AI_KEY_MODES, redactSecret } from "../../services/assistant/aiKeyMode.js";
import {
  removeInstanceKey,
  replaceInstanceKey,
  setAiKeyMode,
  verifyInstanceKey,
} from "../../services/assistant/aiInstanceKeys.js";
import { assertPublicProviderBaseUrl } from "../../services/assistant/providerBaseUrl.js";
import {
  aiProviderPatchSchema,
  listAiProvidersForAdmin,
  patchAiProvider,
} from "../../services/assistant/aiProviderAdmin.js";
import { saveAiFeatureRoutes } from "../../services/assistant/aiRouting.js";
import { providerSettingsReason, writeSettingsAudit } from "../../services/assistant/aiSettingsAudit.js";
import { getSystemProperties } from "../../services/systemProperties.js";

const pluginIdSchema = z.string().regex(/^[a-z0-9-]+$/);
const replaceKeySchema = z.object({
  apiKey: z.string().trim().min(1).max(2000),
});
const keyModeSchema = z.object({
  mode: z.enum(AI_KEY_MODES),
  acknowledgement: z.string().max(200).optional(),
});

function actorId(req: { apiKeyUserId?: number; sessionUserId?: number }): number {
  const id = req.apiKeyUserId ?? req.sessionUserId;
  if (id == null) {
    const err = new Error("Sign in required.");
    (err as Error & { status: number; code: string }).status = 401;
    (err as Error & { status: number; code: string }).code = "not_authenticated";
    throw err;
  }
  return id;
}

function withoutSecret(err: unknown, secret: string): unknown {
  if (!(err instanceof Error) || secret.trim().length < 8) return err;
  const message = redactSecret(err.message, secret);
  if (message === err.message) return err;
  const copy = new Error(message);
  copy.name = err.name;
  Object.assign(copy, err);
  copy.message = message;
  return copy;
}

export function registerAiProviderAdminRoutes(adminRouter: Router): void {
  adminRouter.get("/ai-providers", async (_req, res) => {
    try {
      res.json({ data: await listAiProvidersForAdmin(db) });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  adminRouter.patch("/ai-providers", async (req, res) => {
    try {
      const parsed = aiProviderPatchSchema.parse(req.body ?? {});
      const userId = actorId(req);
      const row = await patchAiProvider(db, parsed);
      await writeSettingsAudit(userId, providerSettingsReason(row.id, "saved", row.enabled));
      res.locals.logMessage = `AI provider ${row.id} ${row.enabled ? "enabled" : "disabled"}`;
      res.json({ data: row });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  adminRouter.put("/ai-providers/:id/key", async (req, res) => {
    const pluginId = pluginIdSchema.safeParse(req.params.id);
    let secret = "";
    try {
      if (!pluginId.success) {
        res.locals.logMessage = "AI instance key replace rejected";
        throw pluginId.error;
      }
      res.locals.logMessage = `AI instance key replace ${pluginId.data}`;
      const body = replaceKeySchema.parse(req.body ?? {});
      secret = body.apiKey;
      const userId = actorId(req);
      const row = await replaceInstanceKey(db, {
        pluginId: pluginId.data,
        apiKey: body.apiKey,
        actorUserId: userId,
      });
      await writeSettingsAudit(userId, providerSettingsReason(pluginId.data, "key_replaced"));
      res.json({ data: row });
    } catch (err) {
      handleRouteError(res, withoutSecret(err, secret));
    }
  });

  adminRouter.delete("/ai-providers/:id/key", async (req, res) => {
    try {
      const pluginId = pluginIdSchema.parse(req.params.id);
      res.locals.logMessage = `AI instance key remove ${pluginId}`;
      const userId = actorId(req);
      const row = await removeInstanceKey(db, pluginId);
      await writeSettingsAudit(userId, providerSettingsReason(pluginId, "key_removed"));
      res.json({ data: row });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  adminRouter.post("/ai-providers/:id/key/verify", async (req, res) => {
    try {
      const pluginId = pluginIdSchema.parse(req.params.id);
      res.locals.logMessage = `AI instance key verify ${pluginId}`;
      const userId = actorId(req);
      const row = await verifyInstanceKey(db, {
        pluginId,
        actorUserId: userId,
        assertBaseUrl: assertPublicProviderBaseUrl,
      });
      await writeSettingsAudit(userId, providerSettingsReason(pluginId, "key_verified"));
      res.json({ data: row });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  adminRouter.patch("/ai-key-mode", async (req, res) => {
    try {
      const body = keyModeSchema.parse(req.body ?? {});
      res.locals.logMessage = `AI key mode ${body.mode}`;
      const row = await setAiKeyMode(db, {
        mode: body.mode,
        acknowledgement: body.acknowledgement,
        actorUserId: actorId(req),
      });
      res.json({
        data: { mode: row.mode, activeUserCount: row.activeUserCount },
      });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  adminRouter.get("/ai/routing", async (_req, res) => {
    try {
      const props = await getSystemProperties(db);
      res.json({ data: props.aiFeatureRoutes });
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  adminRouter.put("/ai/routing", async (req, res) => {
    try {
      res.locals.logMessage = "AI feature routes updated";
      const routes = await saveAiFeatureRoutes(db, req.body ?? {});
      res.json({ data: routes });
    } catch (err) {
      handleRouteError(res, err);
    }
  });
}
