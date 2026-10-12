import { Router } from "express";
import { z } from "zod";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { sendMutation } from "../../lib/mutationResult.js";
import { applyAssistantProposal } from "./assistantApply.js";
import { assistantChatRateLimit } from "../../middleware/rateLimits.js";
import {
  ASSISTANT_UNCONFIGURED,
  assistantStatus,
  buildMessages,
  runConfiguredAssistant,
} from "../../services/assistant/index.js";
import { db } from "../../db/client.js";
import { userHasAdministrator } from "../../services/roles.js";
import { getCurrentUserId } from "../../services/users.js";

export const assistantRouter = Router();

assistantRouter.get("/status", async (_req, res) => {
  try {
    res.json({ data: await assistantStatus(db) });
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

assistantRouter.post("/chat", assistantChatRateLimit, async (req, res) => {
  try {
    const status = await assistantStatus(db);
    if (!status.enabled) {
      sendError(res, 503, "assistant_unconfigured", ASSISTANT_UNCONFIGURED);
      return;
    }

    const parsed = chatBody.parse(req.body ?? {});
    const messages = buildMessages({
      history: parsed.history ?? [],
      userMessage: parsed.message,
      pageContext: parsed.pageContext,
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

    const actorUserId = await getCurrentUserId(db);
    const isAdministrator = await userHasAdministrator(db, actorUserId);

    await runConfiguredAssistant({
      db,
      actorUserId,
      isAdministrator,
      messages,
      model: parsed.model,
      signal: ac.signal,
      handlers: {
        onTool: (info) => writeEvent("tool", info),
        onProposal: (proposal) => writeEvent("proposal", proposal),
        onDelta: (text) => writeEvent("delta", { text }),
        onDone: () => {
          writeEvent("done", {});
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
