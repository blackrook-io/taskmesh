import { Router } from "express";
import { z } from "zod";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { assistantChatRateLimit } from "../../middleware/rateLimits.js";
import {
  buildMessages,
  getAssistantConfig,
  resolveProvider,
  runAssistantWithTools,
} from "../../services/assistant/index.js";

export const assistantRouter = Router();

assistantRouter.get("/status", (_req, res) => {
  try {
    const cfg = getAssistantConfig();
    const provider = resolveProvider();
    res.json({
      data: {
        enabled: Boolean(provider),
        provider: provider?.id ?? cfg.provider,
        model: provider?.defaultModel ?? cfg.model,
        configuredProviders: {
          openai: Boolean(cfg.openaiKey),
        },
        toolsEnabled: true,
      },
    });
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

assistantRouter.post("/chat", assistantChatRateLimit, async (req, res) => {
  try {
    const provider = resolveProvider();
    if (!provider) {
      sendError(
        res,
        503,
        "assistant_unconfigured",
        "Assistant is not configured. Set OPENAI_API_KEY in the server .env and restart.",
      );
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
      provider: provider.id,
      model: parsed.model ?? provider.defaultModel,
      toolsEnabled: true,
    });

    await runAssistantWithTools({
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
