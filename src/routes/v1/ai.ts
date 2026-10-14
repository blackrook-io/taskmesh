import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { ENTITY_TYPES } from "../../lib/entityType.js";
import { assembleContext, ContextAssemblyError } from "../../services/assistant/contextAssembly.js";
import { CaptureError, proposeCapture } from "../../services/assistant/capture/service.js";
import { AnswerError, answerProject } from "../../services/assistant/answer/service.js";
import { confirmCaptureRequest } from "./captureConfirm.js";
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
import {
  checkDraftDuplicates,
  DuplicateActionError,
  ignoreDuplicatePair,
  linkDuplicatePair,
  listPendingDuplicates,
} from "../../services/assistant/duplicates/service.js";
import { isDuplicateEntityType } from "../../services/assistant/duplicates/match.js";
import {
  acceptLinkSuggestion,
  dismissLinkSuggestion,
  LinkSuggestionError,
  listLinkSuggestions,
} from "../../services/assistant/links/service.js";
import { isLinkSubjectType } from "../../services/assistant/links/plan.js";
import { userHasAdministrator } from "../../services/roles.js";
import {
  acceptTagSuggestion,
  dismissTagSuggestion,
  listTagSuggestions,
  TagSuggestionError,
} from "../../services/assistant/tagging/service.js";
import { isTaggableEntityType } from "../../services/entities.js";
import { assertCanAccessTaggableEntity } from "../../services/ownership.js";
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
    allowInventTags: policy.allowInventTags,
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

aiRouter.post("/capture/confirm", async (req, res) => {
  try {
    const userId = await getCurrentUserId(db);
    res.locals.logMessage = "AI capture confirm";
    const data = await confirmCaptureRequest(userId, req.body ?? {});
    res.status(201).json({ data });
  } catch (err) {
    if (err instanceof CaptureError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    handleRouteError(res, err);
  }
});

const answerBody = z
  .object({
    projectId: z.number().int().positive(),
    question: z.string().trim().min(1).max(2_000),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(8_000),
          })
          .strict(),
      )
      .max(40)
      .optional(),
  })
  .strict();

aiRouter.post("/answer", async (req, res) => {
  try {
    const body = answerBody.parse(req.body ?? {});
    const userId = await getCurrentUserId(db);
    res.locals.logMessage = `AI answer project ${body.projectId}`;
    const data = await answerProject(db, {
      actorUserId: userId,
      projectId: body.projectId,
      question: body.question,
      history: body.history,
    });
    res.json({ data });
  } catch (err) {
    if (err instanceof AnswerError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    handleRouteError(res, err);
  }
});

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

aiRouter.get("/tag-suggestions", async (req, res) => {
  try {
    const entityType = z.string().parse(req.query.entityType);
    const entityId = z.coerce.number().int().positive().parse(req.query.entityId);
    if (!isTaggableEntityType(entityType)) {
      sendError(res, 400, "validation_error", "That record cannot be tagged.");
      return;
    }
    const userId = await getCurrentUserId(db);
    await assertCanAccessTaggableEntity(db, userId, entityType, entityId);
    const props = await getSystemProperties(db);
    const data = await listTagSuggestions(db, userId, entityType, entityId, new Date(), props.aiUndoWindowDays);
    res.json({ data });
  } catch (err) {
    handleRouteError(res, err);
  }
});

aiRouter.post("/tag-suggestions/:id/accept", async (req, res) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const userId = await getCurrentUserId(db);
    res.locals.logMessage = `AI tag suggestion accept ${id}`;
    const tag = await acceptTagSuggestion(db, userId, id);
    res.status(201).json({ data: tag });
  } catch (err) {
    if (err instanceof TagSuggestionError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    handleRouteError(res, err);
  }
});

aiRouter.post("/tag-suggestions/:id/dismiss", async (req, res) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const userId = await getCurrentUserId(db);
    res.locals.logMessage = `AI tag suggestion dismiss ${id}`;
    await dismissTagSuggestion(db, userId, id);
    res.status(204).end();
  } catch (err) {
    if (err instanceof TagSuggestionError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    handleRouteError(res, err);
  }
});

const duplicateTypeSchema = z.string().refine(isDuplicateEntityType, "Tasks and ToDos only.");
const duplicatePairSchema = z.object({
  entityType: duplicateTypeSchema,
  entityId: z.number().int().positive(),
  matchType: duplicateTypeSchema,
  matchId: z.number().int().positive(),
});

aiRouter.get("/duplicate-check", async (req, res) => {
  try {
    const entityType = duplicateTypeSchema.parse(req.query.entityType);
    const title = z.string().trim().min(1).max(500).parse(req.query.title);
    const excludeRaw = req.query.excludeId;
    const projectRaw = req.query.projectId;
    const excludeId =
      excludeRaw == null || excludeRaw === ""
        ? null
        : z.coerce.number().int().positive().parse(excludeRaw);
    const projectId =
      projectRaw == null || projectRaw === ""
        ? null
        : z.coerce.number().int().positive().parse(projectRaw);
    const userId = await getCurrentUserId(db);
    const hits = await checkDraftDuplicates(db, userId, entityType, title, excludeId, projectId);
    res.json({ data: { hits } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

aiRouter.get("/duplicate-pairs", async (req, res) => {
  try {
    const entityType = duplicateTypeSchema.parse(req.query.entityType);
    const entityId = z.coerce.number().int().positive().parse(req.query.entityId);
    const userId = await getCurrentUserId(db);
    const hits = await listPendingDuplicates(db, userId, entityType, entityId);
    res.json({ data: { hits } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

aiRouter.post("/duplicate-pairs/ignore", async (req, res) => {
  try {
    const body = duplicatePairSchema.parse(req.body ?? {});
    const userId = await getCurrentUserId(db);
    res.locals.logMessage = `AI duplicate ignore ${body.entityType}:${body.entityId}`;
    await ignoreDuplicatePair(
      db,
      userId,
      { entityType: body.entityType, entityId: body.entityId },
      { entityType: body.matchType, entityId: body.matchId },
    );
    res.status(204).end();
  } catch (err) {
    if (err instanceof DuplicateActionError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    handleRouteError(res, err);
  }
});

const linkSubjectSchema = z.string().refine(isLinkSubjectType, "Tasks, ToDos, ideas, and documents only.");

aiRouter.get("/link-suggestions", async (req, res) => {
  try {
    const entityType = linkSubjectSchema.parse(req.query.entityType);
    const entityId = z.coerce.number().int().positive().parse(req.query.entityId);
    const userId = await getCurrentUserId(db);
    const isAdministrator = await userHasAdministrator(db, userId);
    const suggestions = await listLinkSuggestions(db, { userId, isAdministrator }, entityType, entityId);
    res.json({ data: { suggestions } });
  } catch (err) {
    handleRouteError(res, err);
  }
});

aiRouter.post("/link-suggestions/:id/accept", async (req, res) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const userId = await getCurrentUserId(db);
    const isAdministrator = await userHasAdministrator(db, userId);
    res.locals.logMessage = `AI link suggestion accept ${id}`;
    await acceptLinkSuggestion(db, { userId, isAdministrator }, id);
    res.status(204).end();
  } catch (err) {
    if (err instanceof LinkSuggestionError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    handleRouteError(res, err);
  }
});

aiRouter.post("/link-suggestions/:id/dismiss", async (req, res) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const userId = await getCurrentUserId(db);
    const isAdministrator = await userHasAdministrator(db, userId);
    res.locals.logMessage = `AI link suggestion dismiss ${id}`;
    await dismissLinkSuggestion(db, { userId, isAdministrator }, id);
    res.status(204).end();
  } catch (err) {
    if (err instanceof LinkSuggestionError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    handleRouteError(res, err);
  }
});

aiRouter.post("/duplicate-pairs/link", async (req, res) => {
  try {
    const body = duplicatePairSchema.parse(req.body ?? {});
    const userId = await getCurrentUserId(db);
    res.locals.logMessage = `AI duplicate link ${body.entityType}:${body.entityId}`;
    await linkDuplicatePair(
      db,
      userId,
      { entityType: body.entityType, entityId: body.entityId },
      { entityType: body.matchType, entityId: body.matchId },
    );
    res.status(201).json({ data: { linked: true } });
  } catch (err) {
    if (err instanceof DuplicateActionError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    handleRouteError(res, err);
  }
});
