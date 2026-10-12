import { AiProviderError, type AiChatEvent, type AiToolCall, type AiToolDefinition, type AiUsage, type ProviderFetch } from "./types.js";
import { normalizeProviderBaseUrl } from "./baseUrl.js";
import type { AiChatMessage } from "./types.js";

type OpenAiToolCall = {
  id?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAiMessage = {
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
};

type OpenAiCompletion = {
  choices?: Array<{ message?: OpenAiMessage }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string };
};

type OpenAiChunk = {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string };
};

export function mapProviderHttpError(status: number, message: string): AiProviderError {
  const text = message.toLowerCase();
  if (status === 401 || status === 403) {
    return new AiProviderError("auth", message, status);
  }
  if (status === 404) {
    return new AiProviderError("model_not_found", message, status);
  }
  if (status === 429) {
    if (text.includes("quota") || text.includes("billing") || text.includes("insufficient")) {
      return new AiProviderError("quota", message, status);
    }
    return new AiProviderError("rate_limit", message, status);
  }
  if (status >= 500 || status === 0) {
    return new AiProviderError("network", message, status);
  }
  return new AiProviderError("invalid_config", message, status);
}

function usageFrom(raw: { prompt_tokens?: number; completion_tokens?: number } | undefined): AiUsage | null {
  if (!raw) return null;
  const inputTokens = raw.prompt_tokens;
  const outputTokens = raw.completion_tokens;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") return null;
  return { inputTokens, outputTokens };
}

function readToolCalls(message: OpenAiMessage | undefined): AiToolCall[] {
  const calls = message?.tool_calls ?? [];
  const out: AiToolCall[] = [];
  for (const call of calls) {
    const name = call.function?.name;
    if (!call.id || !name) continue;
    out.push({
      id: call.id,
      name,
      arguments: call.function?.arguments ?? "{}",
    });
  }
  return out;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as OpenAiCompletion;
    return body.error?.message || body.error?.code || res.statusText || "Provider request failed";
  } catch {
    return res.statusText || "Provider request failed";
  }
}

function toWireMessage(message: AiChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function toWireTools(tools: AiToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

async function resolveBase(
  baseUrl: string,
  assertBaseUrl?: (url: string) => Promise<string>,
): Promise<string> {
  if (assertBaseUrl) return assertBaseUrl(baseUrl);
  return normalizeProviderBaseUrl(baseUrl);
}

export async function openAiGet(
  fetchImpl: ProviderFetch,
  url: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      redirect: "manual",
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    const message = err instanceof Error ? err.message : "Failed to reach provider";
    throw new AiProviderError("network", message);
  }
}

function rejectRedirect(res: Response): void {
  if (res.status >= 300 && res.status < 400) {
    throw new AiProviderError("network", "Provider redirects are not followed", res.status);
  }
}

export async function listOpenAiModels(args: {
  fetchImpl: ProviderFetch;
  baseUrl: string;
  apiKey: string | null;
  assertBaseUrl?: (url: string) => Promise<string>;
  signal?: AbortSignal;
}): Promise<Array<{ id: string }>> {
  if (!args.apiKey) throw new AiProviderError("auth", "Provider API key is missing");
  const base = await resolveBase(args.baseUrl, args.assertBaseUrl);
  const res = await openAiGet(args.fetchImpl, `${base}/models`, args.apiKey, args.signal);
  rejectRedirect(res);
  if (!res.ok) throw mapProviderHttpError(res.status, await errorMessage(res));
  const body = (await res.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).flatMap((row) => (row.id ? [{ id: row.id }] : []));
}

export async function verifyOpenAiKey(args: {
  fetchImpl: ProviderFetch;
  baseUrl: string;
  apiKey: string | null;
  assertBaseUrl?: (url: string) => Promise<string>;
  signal?: AbortSignal;
}): Promise<{ ok: true } | { ok: false; error: AiProviderError }> {
  try {
    await listOpenAiModels(args);
    return { ok: true };
  } catch (err) {
    if (err instanceof AiProviderError) return { ok: false, error: err };
    throw err;
  }
}

export async function* streamOpenAiCompatibleChat(args: {
  fetchImpl: ProviderFetch;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  messages: AiChatMessage[];
  tools?: AiToolDefinition[];
  signal?: AbortSignal;
  assertBaseUrl?: (url: string) => Promise<string>;
}): AsyncGenerator<AiChatEvent> {
  if (!args.apiKey) throw new AiProviderError("auth", "Provider API key is missing");
  const base = await resolveBase(args.baseUrl, args.assertBaseUrl);
  const url = `${base}/chat/completions`;
  const useJson = Array.isArray(args.tools);
  const body: Record<string, unknown> = {
    model: args.model,
    messages: args.messages.map(toWireMessage),
  };
  if (useJson) {
    body.tools = toWireTools(args.tools ?? []);
    body.tool_choice = "auto";
  } else {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  let res: Response;
  try {
    res = await args.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        Accept: useJson ? "application/json" : "text/event-stream",
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: args.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    const message = err instanceof Error ? err.message : "Failed to reach provider";
    throw new AiProviderError("network", message);
  }
  rejectRedirect(res);
  if (!res.ok) throw mapProviderHttpError(res.status, await errorMessage(res));

  if (useJson) {
    const completion = (await res.json()) as OpenAiCompletion;
    if (completion.error?.message) {
      throw new AiProviderError("network", completion.error.message);
    }
    const message = completion.choices?.[0]?.message;
    const toolCalls = readToolCalls(message);
    if (toolCalls.length > 0) {
      yield { type: "tool_calls", calls: toolCalls };
    } else if (message?.content) {
      yield { type: "delta", text: message.content };
    }
    const usage = usageFrom(completion.usage);
    if (usage) yield { type: "usage", usage };
    yield { type: "done" };
    return;
  }

  if (!res.body) throw new AiProviderError("network", "Provider returned an empty stream");
  yield* pipeOpenAiSse(res.body);
}

async function* pipeOpenAiSse(body: ReadableStream<Uint8Array>): AsyncGenerator<AiChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: AiUsage | null = null;
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
        if (!payload || payload === "[DONE]") continue;
        let parsed: OpenAiChunk;
        try {
          parsed = JSON.parse(payload) as OpenAiChunk;
        } catch {
          continue;
        }
        if (parsed.error?.message) {
          throw mapProviderHttpError(0, parsed.error.message);
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield { type: "delta", text: delta };
        const nextUsage = usageFrom(parsed.usage);
        if (nextUsage) usage = nextUsage;
      }
    }
  } catch (err) {
    if (err instanceof AiProviderError) throw err;
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new AiProviderError("network", err instanceof Error ? err.message : "Stream failed");
  }
  if (usage) yield { type: "usage", usage };
  yield { type: "done" };
}
