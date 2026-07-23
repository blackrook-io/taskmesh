import type { ChatMessage, LlmProvider, StreamHandlers } from "./types.js";
import { getAssistantConfig } from "./types.js";

type OpenAiChunk = {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  error?: { message?: string };
};

/**
 * Stream chat completions from OpenAI via SSE over the Chat Completions API.
 */
export function createOpenAiProvider(): LlmProvider {
  const cfg = getAssistantConfig();
  const apiKey = cfg.openaiKey;

  return {
    id: "openai",
    configured: Boolean(apiKey),
    defaultModel: cfg.model,
    async streamChat(args) {
      if (!apiKey) {
        args.onError("OpenAI is not configured (set OPENAI_API_KEY)");
        return;
      }

      const model = args.model?.trim() || cfg.model;
      let res: Response;
      try {
        res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            model,
            stream: true,
            messages: args.messages.map((m: ChatMessage) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          signal: args.signal,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to reach OpenAI";
        args.onError(msg);
        return;
      }

      if (!res.ok || !res.body) {
        let detail = res.statusText;
        try {
          const j = (await res.json()) as { error?: { message?: string } };
          if (j.error?.message) detail = j.error.message;
        } catch {
          /* ignore */
        }
        args.onError(`OpenAI error (${res.status}): ${detail}`);
        return;
      }

      await pipeOpenAiSse(res.body, args);
    },
  };
}

async function pipeOpenAiSse(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";

      for (const rawLine of parts) {
        const line = rawLine.trimEnd();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") {
          sawDone = true;
          handlers.onDone();
          return;
        }
        let parsed: OpenAiChunk;
        try {
          parsed = JSON.parse(payload) as OpenAiChunk;
        } catch {
          continue;
        }
        if (parsed.error?.message) {
          handlers.onError(parsed.error.message);
          return;
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) handlers.onDelta(delta);
      }
    }
    if (!sawDone) handlers.onDone();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      handlers.onDone();
      return;
    }
    handlers.onError(err instanceof Error ? err.message : "Stream failed");
  }
}
