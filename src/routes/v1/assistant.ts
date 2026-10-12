import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { sendMutation } from "../../lib/mutationResult.js";
import { applyAssistantProposal } from "./assistantApply.js";
import { assistantChatRateLimit } from "../../middleware/rateLimits.js";
import {
  assistantStatus,
  assistantUnconfiguredMessage,
  buildMessages,
  runConfiguredAssistant,
} from "../../services/assistant/index.js";
import { db } from "../../db/client.js";
import { userHasAdministrator } from "../../services/roles.js";
import { getSystemProperties } from "../../services/systemProperties.js";
import { getCurrentUserId } from "../../services/users.js";
import type { AssistantProposal } from "../../services/assistant/tools.js";
import {
  classifyChangePlan,
  classifyOperation,
  operationFromProposal,
  resolveAiPermissionSettings,
} from "../../services/assistant/aiTiers.js";
import {
  insertUndoJournal,
  journalDraftFromMutation,
  shouldAutoApplyTier1,
} from "../../services/assistant/aiUndo.js";
import { AiFeedbackError, recordAiFeedback, AI_FEEDBACK_KINDS } from "../../services/assistant/aiFeedback.js";

export const assistantRouter = Router();

assistantRouter.get("/status", async (_req, res) => {
  try {
    const actorUserId = await getCurrentUserId(db);
    res.json({ data: await assistantStatus(db, actorUserId) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

const chatBody = z.object({
  message: z.string().min(1).max(32_000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(32_000),
      }),
    )
    .max(40)
    .optional(),
  pageContext: z.string().max(16_000).nullable().optional(),
  model: z.string().min(1).max(120).optional(),
});

const feedbackBody = z.object({
  auditId: z.number().int().positive(),
  kind: z.enum(AI_FEEDBACK_KINDS),
  note: z.string().max(500).optional().nullable(),
});

assistantRouter.put("/feedback", async (req, res) => {
  try {
    const parsed = feedbackBody.parse(req.body ?? {});
    const actorUserId = await getCurrentUserId(db);
    const isAdministrator = await userHasAdministrator(db, actorUserId);
    const recorded = await recordAiFeedback(db, {
      auditId: parsed.auditId,
      actorUserId,
      isAdministrator,
      kind: parsed.kind,
      note: parsed.note,
    });
    res.json({
      data: {
        id: recorded.id,
        auditId: recorded.auditId,
        kind: recorded.kind,
        note: recorded.note,
        createdAt: recorded.createdAt.toISOString(),
        created: recorded.created,
      },
    });
  } catch (err) {
    if (err instanceof AiFeedbackError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    handleRouteError(res, err);
  }
});

assistantRouter.post("/proposals/apply", async (req, res) => {
  try {
    const actorUserId = await getCurrentUserId(db);
    const outcome = await applyAssistantProposal({ body: req.body ?? {}, actorId: actorUserId });
    if (outcome.kind === "denied") {
      res.status(403).json({
        error: {
          code: "ai_policy_denied",
          message: outcome.decision.reason,
          decision: outcome.decision.decision,
          action: "apply",
          tier: outcome.decision.tier,
        },
      });
      return;
    }
    sendMutation(res, outcome.result);
  } catch (err) {
    handleRouteError(res, err);
  }
});

const tier1Body = z.object({ optIn: z.boolean() });

assistantRouter.patch("/tier1-opt-in", async (req, res) => {
  try {
    const parsed = tier1Body.parse(req.body ?? {});
    const actorUserId = await getCurrentUserId(db);
    await db
      .update(schema.users)
      .set({ aiTier1OptIn: parsed.optIn, updatedAt: new Date() })
      .where(eq(schema.users.id, actorUserId));
    const props = await getSystemProperties(db);
    res.json({
      data: { optIn: parsed.optIn, tier1Enabled: props.aiPermissionTiers.tier1Enabled },
    });
  } catch (err) {
    handleRouteError(res, err);
  }
});

async function autoApplyProposal(
  proposal: AssistantProposal,
  actorUserId: number,
  writeEvent: (event: string, data: unknown) => void,
): Promise<void> {
  try {
    const outcome = await applyAssistantProposal({ body: proposal, actorId: actorUserId });
    if (outcome.kind === "denied") {
      writeEvent("apply_failed", { summary: proposal.summary, message: outcome.decision.reason });
      return;
    }
    if (!outcome.result.ok) {
      writeEvent("apply_failed", { summary: proposal.summary, message: outcome.result.message });
      return;
    }
    const draft = journalDraftFromMutation({
      policyAction: proposal.policyAction,
      path: proposal.path,
      entityType: proposal.entityType,
      entityId: proposal.entityId ?? null,
      summary: proposal.summary,
      result: outcome.result,
    });
    if (!draft) return;
    const row = await insertUndoJournal(db, {
      ...draft,
      userId: actorUserId,
      auditId: outcome.auditId,
    });
    writeEvent("applied", { journalId: row.id, summary: row.summary });
  } catch (err) {
    writeEvent("apply_failed", {
      summary: proposal.summary,
      message: err instanceof Error ? err.message : "Could not apply this change",
    });
  }
}

assistantRouter.post("/chat", assistantChatRateLimit, async (req, res) => {
  try {
    const actorUserId = await getCurrentUserId(db);
    const status = await assistantStatus(db, actorUserId);
    if (!status.enabled) {
      sendError(res, 503, "assistant_unconfigured", assistantUnconfiguredMessage(status.keyMode));
      return;
    }

    const parsed = chatBody.parse(req.body ?? {});
    const props = await getSystemProperties(db);
    const messages = buildMessages({
      history: parsed.history ?? [],
      userMessage: parsed.message,
      pageContext: parsed.pageContext,
      webFetchEnabled: props.aiWebFetch,
    });

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }
    const writeEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const ac = new AbortController();
    // Do NOT use req.on("close") — it fires when the request body finishes, which
    // aborts the tool loop immediately. Abort only if the client drops the SSE.
    res.on("close", () => {
      if (!res.writableEnded) ac.abort();
    });

    writeEvent("meta", {
      provider: status.provider,
      model: parsed.model ?? status.model,
      toolsEnabled: true,
    });

    const isAdministrator = await userHasAdministrator(db, actorUserId);
    const [actor] = await db
      .select({ aiTier1OptIn: schema.users.aiTier1OptIn })
      .from(schema.users)
      .where(eq(schema.users.id, actorUserId));
    const tierSettings = resolveAiPermissionSettings(props.aiPermissionTiers, {
      tier1OptIn: actor?.aiTier1OptIn === true,
    });
    const proposals: AssistantProposal[] = [];

    await runConfiguredAssistant({
      db,
      actorUserId,
      isAdministrator,
      messages,
      model: parsed.model,
      signal: ac.signal,
      handlers: {
        onTool: (info) => writeEvent("tool", info),
        onProposal: (proposal) => {
          proposals.push(proposal);
        },
        onDelta: (text) => writeEvent("delta", { text }),
        onDone: async (info) => {
          const plan = classifyChangePlan(
            proposals.map((proposal) => operationFromProposal(proposal, actorUserId)),
            tierSettings,
          );
          if (shouldAutoApplyTier1(plan.tier, tierSettings)) {
            for (const proposal of proposals) {
              await autoApplyProposal(proposal, actorUserId, writeEvent);
            }
          } else {
            for (const proposal of proposals) {
              const classified = classifyOperation(
                operationFromProposal(proposal, actorUserId),
                tierSettings,
              );
              writeEvent("proposal", { ...proposal, tier: classified.tier });
            }
          }
          writeEvent("done", {
            planTier: plan.tier,
            planEscalations: plan.escalations,
            auditId: info?.auditId ?? null,
          });
          res.end();
        },
        onError: (message) => {
          writeEvent("error", { message });
          res.end();
        },
      },
    });
  } catch (err) {
    if (!res.headersSent) {
      handleRouteError(res, err);
      return;
    }
    try {
      res.write(
        `event: error\ndata: ${JSON.stringify({ message: err instanceof Error ? err.message : "Chat failed" })}\n\n`,
      );
    } catch {
      /* ignore */
    }
    res.end();
  }
});
