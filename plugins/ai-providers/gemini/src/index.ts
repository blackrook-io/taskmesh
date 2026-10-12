import { z } from "zod";
import {
  AiProviderError,
  mapProviderHttpError,
  normalizeProviderBaseUrl,
  publicHttpsBaseUrlSchema,
  type AiChatEvent,
  type AiChatMessage,
  type AiProviderContext,
  type AiProviderPlugin,
  type AiToolCall,
  type AiToolDefinition,
  type AiUsage,
  type ProviderFetch,
} from "@taskmesh/ai-provider-contract";

const EMBEDDING_MODEL = "gemini-embedding-001";
const THINKING_LEVEL = "low";

const configSchema = z.object({
  baseUrl: publicHttpsBaseUrlSchema().default("https://generativelanguage.googleapis.com/v1beta"),
  defaultModel: z.string().trim().min(1).max(120).default("gemini-3.8-flash"),
});

type GeminiConfig = z.infer<typeof configSchema>;

type GeminiPart = {
  text?: string;
  functionCall?: { name?: string; args?: unknown };
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  embeddings?: Array<{ values?: number[] }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string; status?: string };
};

type WireContent = {
  role: "user" | "model";
  parts: Array<Record<string, unknown>>;
};

function readConfig(config: unknown): GeminiConfig {
  return configSchema.parse(config);
}

function fetchOf(ctx: AiProviderContext): ProviderFetch {
  return ctx.fetchImpl ?? ((input, init) => fetch(input, init));
}

async function resolveBase(
  baseUrl: string,
  assertBaseUrl?: (url: string) => Promise<string>,
): Promise<string> {
  if (assertBaseUrl) return assertBaseUrl(baseUrl);
  return normalizeProviderBaseUrl(baseUrl);
}

function requireKey(apiKey: string | null): string {
  const key = apiKey?.trim();
  if (!key) throw new AiProviderError("auth", "Provider API key is missing");
  return key;
}

function rejectRedirect(res: Response): void {
  if (res.status >= 300 && res.status < 400) {
    throw new AiProviderError("network", "Provider redirects are not followed", res.status);
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as GeminiResponse;
    return body.error?.message || body.error?.status || res.statusText || "Provider request failed";
  } catch {
    return res.statusText || "Provider request failed";
  }
}

function chatUsage(raw: GeminiResponse["usageMetadata"]): AiUsage | null {
  if (!raw) return null;
  if (typeof raw.promptTokenCount !== "number" || typeof raw.candidatesTokenCount !== "number") return null;
  return { inputTokens: raw.promptTokenCount, outputTokens: raw.candidatesTokenCount };
}

function embedUsage(raw: GeminiResponse["usageMetadata"]): AiUsage | undefined {
  const tokens = raw?.promptTokenCount ?? raw?.totalTokenCount;
  if (typeof tokens !== "number") return undefined;
  return { inputTokens: tokens, outputTokens: 0 };
}

function parseToolInput(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
}

function argumentsFromInput(input: unknown): string {
  if (typeof input === "string") return input || "{}";
  if (input === undefined) return "{}";
  return JSON.stringify(input);
}

function responseObject(content: string): Record<string, unknown> {
  const text = content.trim();
  if (!text) return { result: "" };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Tool results are plain text.
  }
  return { result: content };
}

function toGeminiContents(messages: AiChatMessage[]): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: WireContent[];
} {
  const systemParts: string[] = [];
  const contents: WireContent[] = [];
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "system") {
      if (message.content.trim()) systemParts.push(message.content);
      continue;
    }
    if (message.role === "tool") {
      const name = toolNames.get(message.toolCallId) ?? message.toolCallId;
      const part = { functionResponse: { name, response: responseObject(message.content) } };
      const last = contents.at(-1);
      if (last?.role === "user") last.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
      continue;
    }
    if (message.role === "assistant") {
      const parts: Array<Record<string, unknown>> = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        toolNames.set(call.id, call.name);
        parts.push({ functionCall: { name: call.name, args: parseToolInput(call.arguments) } });
      }
      if (parts.length === 0) parts.push({ text: message.content ?? "" });
      contents.push({ role: "model", parts });
      continue;
    }
    contents.push({ role: "user", parts: [{ text: message.content }] });
  }
  const system = systemParts.join("\n\n");
  return system ? { systemInstruction: { parts: [{ text: system }] }, contents } : { contents };
}

function toWireTools(tools: AiToolDefinition[]): unknown[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
  ];
}

function readToolCalls(parts: GeminiPart[]): AiToolCall[] {
  const calls: AiToolCall[] = [];
  for (const part of parts) {
    const name = part.functionCall?.name;
    if (!name) continue;
    calls.push({
      id: `call_${calls.length + 1}`,
      name,
      arguments: argumentsFromInput(part.functionCall?.args),
    });
  }
  return calls;
}

function modelId(name: string): string {
  return name.startsWith("models/") ? name.slice("models/".length) : name;
}

async function geminiRequest(args: {
  fetchImpl: ProviderFetch;
  url: string;
  apiKey: string;
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  accept: string;
  signal?: AbortSignal;
}): Promise<Response> {
  try {
    return await args.fetchImpl(args.url, {
      method: args.method,
      headers: {
        "x-goog-api-key": args.apiKey,
        Accept: args.accept,
        ...(args.body ? { "Content-Type": "application/json" } : {}),
      },
      body: args.body ? JSON.stringify(args.body) : undefined,
      redirect: "manual",
      signal: args.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    const message = err instanceof Error ? err.message : "Failed to reach provider";
    throw new AiProviderError("network", message);
  }
}

async function listModels(ctx: AiProviderContext): Promise<Array<{ id: string; label?: string }>> {
  const config = readConfig(ctx.config);
  const apiKey = requireKey(ctx.apiKey);
  const base = await resolveBase(config.baseUrl, ctx.assertBaseUrl);
  const res = await geminiRequest({
    fetchImpl: fetchOf(ctx),
    url: `${base}/models`,
    apiKey,
    method: "GET",
    accept: "application/json",
  });
  rejectRedirect(res);
  if (!res.ok) throw mapProviderHttpError(res.status, await errorMessage(res));
  const body = (await res.json()) as { models?: Array<{ name?: string; displayName?: string }> };
  return (body.models ?? []).flatMap((row) => {
    if (!row.name) return [];
    const id = modelId(row.name);
    return row.displayName ? [{ id, label: row.displayName }] : [{ id }];
  });
}

async function verifyKey(
  ctx: AiProviderContext,
): Promise<{ ok: true } | { ok: false; error: AiProviderError }> {
  try {
    await listModels(ctx);
    return { ok: true };
  } catch (err) {
    if (err instanceof AiProviderError) return { ok: false, error: err };
    throw err;
  }
}

function chatBody(
  messages: AiChatMessage[],
  tools: AiToolDefinition[] | undefined,
): Record<string, unknown> {
  const mapped = toGeminiContents(messages);
  const body: Record<string, unknown> = {
    contents: mapped.contents,
    generationConfig: { thinkingConfig: { thinkingLevel: THINKING_LEVEL } },
  };
  if (mapped.systemInstruction) body.systemInstruction = mapped.systemInstruction;
  if (tools && tools.length > 0) body.tools = toWireTools(tools);
  return body;
}

async function* streamChat(
  ctx: AiProviderContext,
  args: {
    messages: AiChatMessage[];
    tools?: AiToolDefinition[];
    model?: string;
    signal?: AbortSignal;
  },
): AsyncGenerator<AiChatEvent> {
  const config = readConfig(ctx.config);
  const apiKey = requireKey(ctx.apiKey);
  const base = await resolveBase(config.baseUrl, ctx.assertBaseUrl);
  const model = encodeURIComponent(args.model?.trim() || config.defaultModel);
  const useJson = Array.isArray(args.tools);
  const url = useJson
    ? `${base}/models/${model}:generateContent`
    : `${base}/models/${model}:streamGenerateContent?alt=sse`;
  const res = await geminiRequest({
    fetchImpl: fetchOf(ctx),
    url,
    apiKey,
    method: "POST",
    body: chatBody(args.messages, args.tools),
    accept: useJson ? "application/json" : "text/event-stream",
    signal: args.signal,
  });
  rejectRedirect(res);
  if (!res.ok) throw mapProviderHttpError(res.status, await errorMessage(res));

  if (useJson) {
    yield* readJsonMessage(res);
    return;
  }
  if (!res.body) throw new AiProviderError("network", "Provider returned an empty stream");
  yield* pipeGeminiSse(res.body);
}

async function* readJsonMessage(res: Response): AsyncGenerator<AiChatEvent> {
  const message = (await res.json()) as GeminiResponse;
  if (message.error?.message) throw new AiProviderError("network", message.error.message);
  yield* eventsFromResponse(message);
  yield { type: "done" };
}

function* eventsFromResponse(message: GeminiResponse): Generator<AiChatEvent> {
  const parts = message.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => part.text ?? "")
    .filter((part) => part.length > 0)
    .join("");
  const toolCalls = readToolCalls(parts);
  if (toolCalls.length > 0) yield { type: "tool_calls", calls: toolCalls };
  else if (text) yield { type: "delta", text };
  const usage = chatUsage(message.usageMetadata);
  if (usage) yield { type: "usage", usage };
}

async function* pipeGeminiSse(body: ReadableStream<Uint8Array>): AsyncGenerator<AiChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const calls: AiToolCall[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let event: GeminiResponse;
        try {
          event = JSON.parse(payload) as GeminiResponse;
        } catch {
          continue;
        }
        if (event.error?.message) throw new AiProviderError("network", event.error.message);
        const usage = event.usageMetadata;
        if (typeof usage?.promptTokenCount === "number") inputTokens = usage.promptTokenCount;
        if (typeof usage?.candidatesTokenCount === "number") outputTokens = usage.candidatesTokenCount;
        const parts = event.candidates?.[0]?.content?.parts ?? [];
        const text = parts
          .map((part) => part.text ?? "")
          .filter((part) => part.length > 0)
          .join("");
        if (text) yield { type: "delta", text };
        for (const call of readToolCalls(parts)) {
          calls.push({ ...call, id: `call_${calls.length + 1}` });
        }
      }
    }
  } catch (err) {
    if (err instanceof AiProviderError) throw err;
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new AiProviderError("network", err instanceof Error ? err.message : "Stream failed");
  }

  if (calls.length > 0) yield { type: "tool_calls", calls };
  if (typeof inputTokens === "number" && typeof outputTokens === "number") {
    yield { type: "usage", usage: { inputTokens, outputTokens } };
  }
  yield { type: "done" };
}

async function embed(
  ctx: AiProviderContext,
  texts: string[],
): Promise<{ vectors: number[][]; usage?: AiUsage }> {
  if (texts.length === 0) return { vectors: [] };
  const config = readConfig(ctx.config);
  const apiKey = requireKey(ctx.apiKey);
  const base = await resolveBase(config.baseUrl, ctx.assertBaseUrl);
  const modelName = `models/${EMBEDDING_MODEL}`;
  const res = await geminiRequest({
    fetchImpl: fetchOf(ctx),
    url: `${base}/models/${EMBEDDING_MODEL}:batchEmbedContents`,
    apiKey,
    method: "POST",
    body: {
      requests: texts.map((text) => ({
        model: modelName,
        content: { parts: [{ text }] },
      })),
    },
    accept: "application/json",
  });
  rejectRedirect(res);
  if (!res.ok) throw mapProviderHttpError(res.status, await errorMessage(res));
  const body = (await res.json()) as GeminiResponse;
  if (body.error?.message) throw new AiProviderError("network", body.error.message);
  const vectors = (body.embeddings ?? []).map((row) => row.values ?? []);
  if (vectors.length !== texts.length || vectors.some((vector) => vector.length === 0)) {
    throw new AiProviderError("network", "Provider returned an incomplete embedding");
  }
  const usage = embedUsage(body.usageMetadata);
  return usage ? { vectors, usage } : { vectors };
}

export const plugin: AiProviderPlugin = {
  id: "gemini",
  displayName: "Google Gemini",
  version: "1.0.0",
  configSchema,
  capabilities: {
    chat: true,
    streaming: true,
    tools: true,
    embeddings: true,
    local: false,
  },
  listModels,
  verifyKey,
  streamChat,
  embed,
};

export { configSchema };
