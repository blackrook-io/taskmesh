import { z } from "zod";
import {
  AiProviderError,
  localProviderBaseUrlSchema,
  mapProviderHttpError,
  normalizeLocalProviderBaseUrl,
  type AiChatEvent,
  type AiChatMessage,
  type AiProviderPlugin,
  type AiToolCall,
  type AiToolDefinition,
  type AiUsage,
  type ProviderFetch,
} from "@taskmesh/ai-provider-contract";

const configSchema = z.object({
  baseUrl: localProviderBaseUrlSchema().default("http://127.0.0.1:11434"),
  defaultModel: z.string().trim().min(1).max(120).default("llama3.2"),
  embeddingModel: z.string().trim().min(1).max(120).default("nomic-embed-text"),
});

type OllamaConfig = z.infer<typeof configSchema>;

function headers(apiKey: string | null, jsonBody: boolean): Record<string, string> {
  const out: Record<string, string> = {
    Accept: "application/json, application/x-ndjson, text/plain",
  };
  if (apiKey) out.Authorization = `Bearer ${apiKey}`;
  if (jsonBody) out["Content-Type"] = "application/json";
  return out;
}

function unreachable(base: string, err: unknown): never {
  if (err instanceof Error && err.name === "AbortError") throw err;
  if (err instanceof AiProviderError) throw err;
  throw new AiProviderError("network", `Ollama is unreachable at ${base}`);
}

async function ollamaFetch(
  fetchImpl: ProviderFetch,
  url: string,
  init: RequestInit,
  base: string,
): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, redirect: "manual" });
  } catch (err) {
    unreachable(base, err);
  }
}

function rejectRedirect(res: Response): void {
  if (res.status >= 300 && res.status < 400) {
    throw new AiProviderError("network", "Provider redirects are not followed", res.status);
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
    if (body.error && typeof body.error === "object") {
      const err = body.error as { message?: string; code?: string };
      return err.message || err.code || res.statusText || "Ollama request failed";
    }
  } catch {
    // Body was not JSON.
  }
  return res.statusText || "Ollama request failed";
}

function throwForStatus(status: number, message: string): never {
  const text = message.toLowerCase();
  if (status === 404 || text.includes("not found")) {
    throw new AiProviderError("model_not_found", message, status);
  }
  if (text.includes("does not support tools") || (status === 400 && text.includes("tool"))) {
    throw new AiProviderError("unsupported", message, status);
  }
  throw mapProviderHttpError(status, message);
}

async function resolveBase(
  baseUrl: string,
  assertBaseUrl?: (url: string) => Promise<string>,
): Promise<string> {
  if (assertBaseUrl) return assertBaseUrl(baseUrl);
  return normalizeLocalProviderBaseUrl(baseUrl);
}

function readToolCalls(raw: unknown): AiToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: AiToolCall[] = [];
  for (const [index, call] of raw.entries()) {
    if (!call || typeof call !== "object") continue;
    const rec = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = rec.function?.name;
    if (typeof name !== "string" || !name) continue;
    const args = rec.function?.arguments;
    const id = typeof rec.id === "string" && rec.id ? rec.id : `call_${index + 1}`;
    out.push({
      id,
      name,
      arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
    });
  }
  return out;
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function toOllamaMessages(messages: AiChatMessage[]): unknown[] {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "assistant" && message.toolCalls) {
      for (const call of message.toolCalls) names.set(call.id, call.name);
    }
  }
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content,
        tool_name: names.get(message.toolCallId) ?? message.toolCallId,
      };
    }
    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: message.content ?? "",
        tool_calls: message.toolCalls.map((call) => ({
          function: { name: call.name, arguments: parseArguments(call.arguments) },
        })),
      };
    }
    return { role: message.role, content: message.content ?? "" };
  });
}

function toOllamaTools(tools: AiToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function usageFrom(body: Record<string, unknown>): AiUsage | null {
  const inputTokens = body.prompt_eval_count;
  const outputTokens = body.eval_count;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") return null;
  return { inputTokens, outputTokens };
}

function eventsFromChunk(body: Record<string, unknown>): AiChatEvent[] {
  if (typeof body.error === "string" && body.error.trim()) {
    throwForStatus(400, body.error);
  }
  const events: AiChatEvent[] = [];
  const message =
    body.message && typeof body.message === "object"
      ? (body.message as { content?: unknown; tool_calls?: unknown })
      : undefined;
  if (typeof message?.content === "string" && message.content) {
    events.push({ type: "delta", text: message.content });
  }
  const calls = readToolCalls(message?.tool_calls);
  if (calls.length > 0) events.push({ type: "tool_calls", calls });
  if (body.done === true) {
    const usage = usageFrom(body);
    if (usage) events.push({ type: "usage", usage });
  }
  return events;
}

async function* readChunks(res: Response): AsyncGenerator<Record<string, unknown>> {
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  if (!reader) {
    buffer = await res.text();
  } else {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        yield parseChunk(trimmed);
      }
    }
    buffer += decoder.decode();
  }
  const tail = buffer.trim();
  if (!tail) return;
  if (reader) {
    yield parseChunk(tail);
    return;
  }
  const lines = tail.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) yield parseChunk(line);
}

function parseChunk(line: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new AiProviderError("invalid_config", "Ollama returned an unreadable response");
  }
}

async function* streamChat(
  fetchImpl: ProviderFetch,
  base: string,
  apiKey: string | null,
  model: string,
  messages: AiChatMessage[],
  tools: AiToolDefinition[] | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<AiChatEvent> {
  const payload: Record<string, unknown> = {
    model,
    messages: toOllamaMessages(messages),
    stream: true,
  };
  if (tools && tools.length > 0) payload.tools = toOllamaTools(tools);
  const res = await ollamaFetch(
    fetchImpl,
    `${base}/api/chat`,
    {
      method: "POST",
      headers: headers(apiKey, true),
      body: JSON.stringify(payload),
      signal,
    },
    base,
  );
  rejectRedirect(res);
  if (!res.ok) throwForStatus(res.status, await errorMessage(res));
  for await (const chunk of readChunks(res)) {
    yield* eventsFromChunk(chunk);
  }
  yield { type: "done" };
}

export const plugin: AiProviderPlugin = {
  id: "ollama",
  displayName: "Ollama",
  version: "1.0.0",
  configSchema,
  capabilities: {
    chat: true,
    streaming: true,
    tools: true,
    embeddings: true,
    local: true,
  },
  async listModels(ctx) {
    const config = configSchema.parse(ctx.config) as OllamaConfig;
    const base = await resolveBase(config.baseUrl, ctx.assertBaseUrl);
    const res = await ollamaFetch(
      ctx.fetchImpl ?? fetch,
      `${base}/api/tags`,
      { method: "GET", headers: headers(ctx.apiKey, false), signal: undefined },
      base,
    );
    rejectRedirect(res);
    if (!res.ok) throwForStatus(res.status, await errorMessage(res));
    const body = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    return (body.models ?? []).flatMap((row) => {
      const id = row.name || row.model;
      return id ? [{ id }] : [];
    });
  },
  async verifyKey(ctx) {
    try {
      const config = configSchema.parse(ctx.config) as OllamaConfig;
      const base = await resolveBase(config.baseUrl, ctx.assertBaseUrl);
      const res = await ollamaFetch(
        ctx.fetchImpl ?? fetch,
        `${base}/`,
        { method: "GET", headers: headers(ctx.apiKey, false) },
        base,
      );
      rejectRedirect(res);
      if (!res.ok) throwForStatus(res.status, await errorMessage(res));
      return { ok: true };
    } catch (err) {
      if (err instanceof AiProviderError) return { ok: false, error: err };
      throw err;
    }
  },
  streamChat(ctx, args) {
    const config = configSchema.parse(ctx.config) as OllamaConfig;
    const model = args.model?.trim() || config.defaultModel;
    return (async function* () {
      const base = await resolveBase(config.baseUrl, ctx.assertBaseUrl);
      yield* streamChat(
        ctx.fetchImpl ?? fetch,
        base,
        ctx.apiKey,
        model,
        args.messages,
        args.tools,
        args.signal,
      );
    })();
  },
  async embed(ctx, texts) {
    const config = configSchema.parse(ctx.config) as OllamaConfig;
    const base = await resolveBase(config.baseUrl, ctx.assertBaseUrl);
    const res = await ollamaFetch(
      ctx.fetchImpl ?? fetch,
      `${base}/api/embed`,
      {
        method: "POST",
        headers: headers(ctx.apiKey, true),
        body: JSON.stringify({ model: config.embeddingModel, input: texts }),
      },
      base,
    );
    rejectRedirect(res);
    if (!res.ok) throwForStatus(res.status, await errorMessage(res));
    const body = (await res.json()) as { embeddings?: unknown; prompt_eval_count?: number };
    if (!Array.isArray(body.embeddings)) {
      throw new AiProviderError("invalid_config", "Ollama returned no embeddings");
    }
    const vectors = body.embeddings.map((row) => {
      if (!Array.isArray(row) || row.some((value) => typeof value !== "number")) {
        throw new AiProviderError("invalid_config", "Ollama returned no embeddings");
      }
      return row as number[];
    });
    const usage =
      typeof body.prompt_eval_count === "number"
        ? { inputTokens: body.prompt_eval_count, outputTokens: 0 }
        : undefined;
    return { vectors, usage };
  },
};

export { configSchema };
