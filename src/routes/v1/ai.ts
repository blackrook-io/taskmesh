import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { ENTITY_TYPES } from "../../lib/entityType.js";
import { assembleContext, ContextAssemblyError } from "../../services/assistant/contextAssembly.js";
import { CaptureError, proposeCapture } from "../../services/assistant/capture/service.js";
import { redactSecret } from "../../services/assistant/aiKeyMode.js";
import { AiCredentialsError } from "../../services/assistant/aiInstanceKeys.js";
import { listAiCapabilities, readUserAiUsage } from "../../services/assistant/aiCapabilities.js";
import {
  loadUserAiPolicy,
  lockedUserPolicyKeys,
  saveUserAiPolicy,
  UserAiPolicyError,
} from "../../services/assistant/aiUserPolicy.js";
import { listUserCredentials, removeUserKey, replaceUserKey } from "../../services/assistant/aiUserKeys.js";
import { AiRoutingError, listAiRouting, setUserRoutePreference } from "../../services/assistant/aiRouting.js";
import { getSystemProperties } from "../../services/systemProperties.js";
import { listAiActivity, undoJournalEntry } from "../../services/assistant/aiUndo.js";
import { getCurrentUserId } from "../../services/users.js";

export const aiRouter = Router();

const pluginIdSchema = z.string().regex(/^[a-z0-9-]+$/);
const featureIdSchema = z.string().regex(/^[a-z0-9_]+$/);
const routePinSchema = z.object({
  pluginId: z.string().regex(/^[a-z0-9-]+$/).nullable(),
  model: z.string().trim().min(1).max(120).nullable(),
});
const replaceKeySchema = z.object({
  apiKey: z.string().trim().min(1).max(2000),
  defaultModel: z.string().max(120).nullable().optional(),
});

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

function sendCredentialsError(res: Parameters<typeof sendError>[0], err: unknown, secret = ""): void {
  const safe = withoutSecret(err, secret);
  if (safe instanceof AiCredentialsError) {
    sendError(res, safe.status, safe.code, safe.message);
    return;
  }
  handleRouteError(res, safe);
}

aiRouter.get("/credentials", async (_req, res) => {
  try {
    const userId = await getCurrentUserId(db);
    res.json({ data: await listUserCredentials(db, userId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

aiRouter.put("/credentials/:pluginId", async (req, res) => {
  const pluginId = pluginIdSchema.safeParse(req.params.pluginId);
  let secret = "";
  try {
    if (!pluginId.success) {
      res.locals.logMessage = "AI user key replace rejected";
      throw pluginId.error;
    }
    res.locals.logMessage = `AI user key replace ${pluginId.data}`;
    const body = replaceKeySchema.parse(req.body ?? {});
    secret = body.apiKey;
    const userId = await getCurrentUserId(db);
    const row = await replaceUserKey(db, {
      userId,
      pluginId: pluginId.data,
      apiKey: body.apiKey,
      defaultModel: body.defaultModel,
    });
    res.json({ data: row });
  } catch (err) {
    sendCredentialsError(res, err, secret);
  }
});

aiRouter.delete("/credentials/:pluginId", async (req, res) => {
  try {
    const pluginId = pluginIdSchema.parse(req.params.pluginId);
    res.locals.logMessage = `AI user key remove ${pluginId}`;
    const userId = await getCurrentUserId(db);
    const row = await removeUserKey(db, { userId, pluginId });
    res.json({ data: row });
  } catch (err) {
    sendCredentialsError(res, err);
  }
});

async function adminLockedFeatureIds(
  userId: number,
): Promise<string[]> {
  const rows = await listAiCapabilities(db, { userId, ignoreUserOff: true });
  return rows.filter((row) => row.reason === "disabled_by_administrator").map((row) => row.id);
}

async function userPolicyView(userId: number) {
  const props = await getSystemProperties(db);
  const policy = await loadUserAiPolicy(db, userId);
  const shown = await listAiCapabilities(db, { userId });
  const raw = await listAiCapabilities(db, { userId, ignoreUserOff: true });
  return {
    raised: policy.raised,
    off: policy.off,
    featuresOff: policy.featuresOff,
    ceiling: props.aiPermissionTiers,
    locked: lockedUserPolicyKeys(props.aiWebFetch),
    webFetchEnabled: props.aiWebFetch,
    features: raw.map((row) => {
      const live = shown.find((item) => item.id === row.id) ?? row;
      return {
        id: row.id,
        available: live.available,
        reason: live.reason,
        enabled: !policy.featuresOff.includes(row.id),
        locked: row.reason === "disabled_by_administrator",
      };
    }),
  };
}

aiRouter.get("/policy", async (_req, res) => {
  try {
    const userId = await getCurrentUserId(db);
    res.json({ data: await userPolicyView(userId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

aiRouter.put("/policy", async (req, res) => {
  try {
    const userId = await getCurrentUserId(db);
    res.locals.logMessage = "AI user policy save";
    await saveUserAiPolicy(db, userId, req.body ?? {}, {
      adminLockedFeatures: await adminLockedFeatureIds(userId),
    });
    res.json({ data: await userPolicyView(userId) });
  } catch (err) {
    if (err instanceof UserAiPolicyError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    handleRouteError(res, err);
  }
});

aiRouter.get("/usage", async (_req, res) => {
  try {
    const userId = await getCurrentUserId(db);
    res.json({ data: await readUserAiUsage(db, userId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

aiRouter.get("/capabilities", async (req, res) => {
  try {
    const rawProject = req.query.projectId;
    const projectId =
      rawProject == null || rawProject === ""
        ? undefined
        : z.coerce.number().int().positive().parse(rawProject);
    const userId = await getCurrentUserId(db);
    res.json({ data: await listAiCapabilities(db, { userId, projectId }) });
  } catch (err) {
    sendCredentialsError(res, err);
  }
});

const undoBody = z.object({
  force: z.boolean().optional(),
  skip: z.boolean().optional(),
});

aiRouter.get("/activity", async (_req, res) => {
  try {
    const userId = await getCurrentUserId(db);
    const props = await getSystemProperties(db);
    const items = await listAiActivity(db, userId, new Date(), props.aiUndoWindowDays);
    res.json({ data: { windowDays: props.aiUndoWindowDays, items } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

aiRouter.post("/activity/:id/undo", async (req, res) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = undoBody.parse(req.body ?? {});
    const userId = await getCurrentUserId(db);
    const props = await getSystemProperties(db);
    const outcome = await undoJournalEntry(db, {
      id,
      userId,
      force: body.force === true,
      skip: body.skip === true,
      now: new Date(),
      windowDays: props.aiUndoWindowDays,
    });
    if (!outcome.ok) {
      res.status(outcome.status).json({
        error: {
          code: outcome.code,
          message: outcome.message,
          ...(outcome.change !== undefined ? { change: outcome.change } : {}),
          ...(outcome.canForce !== undefined ? { canForce: outcome.canForce } : {}),
        },
      });
      return;
    }
    res.json({ data: { id, status: outcome.status } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

aiRouter.get("/routing", async (_req, res) => {
  try {
    const userId = await getCurrentUserId(db);
    res.json({ data: await listAiRouting(db, userId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

const contextBody = z
  .object({
    feature: z.string().regex(/^[a-z0-9_]{1,40}$/),
    entityType: z.enum(ENTITY_TYPES),
    entityId: z.number().int().positive(),
    query: z.string().max(500).optional(),
    budgetTokens: z.number().int().min(256).max(32_000).optional(),
  })
  .strict();

const captureBody = z
  .object({
    text: z.string().trim().min(1).max(2_000),
    projectId: z.number().int().positive().optional(),
    todoListId: z.number().int().positive().optional(),
    timeZone: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

aiRouter.post("/capture", async (req, res) => {
  try {
    const body = captureBody.parse(req.body ?? {});
    const userId = await getCurrentUserId(db);
    res.locals.logMessage = "AI capture";
    const data = await proposeCapture(db, {
      actorUserId: userId,
      text: body.text,
      projectId: body.projectId,
      todoListId: body.todoListId,
      timeZone: body.timeZone,
    });
    res.json({ data });
  } catch (err) {
    if (err instanceof CaptureError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    handleRouteError(res, err);
  }
});

aiRouter.post("/context", async (req, res) => {
  try {
    const body = contextBody.parse(req.body ?? {});
    const userId = await getCurrentUserId(db);
    res.locals.logMessage = `AI context ${body.feature} ${body.entityType} ${body.entityId}`;
    const data = await assembleContext({
      actorId: userId,
      feature: body.feature,
      entityType: body.entityType,
      entityId: body.entityId,
      query: body.query,
      budgetTokens: body.budgetTokens,
    });
    res.json({ data });
  } catch (err) {
    if (err instanceof ContextAssemblyError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    handleRouteError(res, err);
  }
});

aiRouter.put("/routing/:feature", async (req, res) => {
  try {
    const feature = featureIdSchema.parse(req.params.feature);
    const body = routePinSchema.parse(req.body ?? {});
    const clearing = body.pluginId == null && body.model == null;
    const setting = body.pluginId != null && body.model != null;
    if (!clearing && !setting) {
      sendError(res, 400, "validation_error", "Send both pluginId and model, or null for both.");
      return;
    }
    res.locals.logMessage = clearing ? `AI route clear ${feature}` : `AI route ${feature} ${body.pluginId}`;
    const userId = await getCurrentUserId(db);
    const preference = await setUserRoutePreference(db, {
      userId,
      feature,
      pin: setting ? { pluginId: body.pluginId!, model: body.model! } : null,
    });
    res.json({ data: { feature, preference } });
  } catch (err) {
    if (err instanceof AiRoutingError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    handleRouteError(res, err);
  }
});
