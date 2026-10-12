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

const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 8192;

const configSchema = z.object({
  baseUrl: publicHttpsBaseUrlSchema().default("https://api.anthropic.com"),
  defaultModel: z.string().trim().min(1).max(120).default("claude-sonnet-4-5"),
});

type AnthropicConfig = z.infer<typeof configSchema>;

type WireMessage = {
  role: "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

type AnthropicBlock = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
};

type AnthropicMessage = {
  content?: AnthropicBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; type?: string };
};

type AnthropicStreamEvent = {
  type?: string;
  index?: number;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

function readConfig(config: unknown): AnthropicConfig {
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
    const body = (await res.json()) as AnthropicMessage;
    return body.error?.message || body.error?.type || res.statusText || "Provider request failed";
  } catch {
    return res.statusText || "Provider request failed";
  }
}

function usageFrom(raw: { input_tokens?: number; output_tokens?: number } | undefined): AiUsage | null {
  if (!raw) return null;
  if (typeof raw.input_tokens !== "number" || typeof raw.output_tokens !== "number") return null;
  return { inputTokens: raw.input_tokens, outputTokens: raw.output_tokens };
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

function toAnthropicMessages(messages: AiChatMessage[]): { system?: string; messages: WireMessage[] } {
  const systemParts: string[] = [];
  const out: WireMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      if (message.content.trim()) systemParts.push(message.content);
      continue;
    }
    if (message.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      const last = out.at(-1);
      if (last?.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }
    if (message.role === "assistant") {
      const blocks: Array<Record<string, unknown>> = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: parseToolInput(call.arguments),
        });
      }
      if (blocks.length === 0) blocks.push({ type: "text", text: message.content ?? "" });
      out.push({ role: "assistant", content: blocks });
      continue;
    }
    out.push({ role: "user", content: message.content });
  }
  const system = systemParts.join("\n\n");
  return system ? { system, messages: out } : { messages: out };
}

function toWireTools(tools: AiToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

function readToolCalls(blocks: AnthropicBlock[]): AiToolCall[] {
  const calls: AiToolCall[] = [];
  for (const block of blocks) {
    if (block.type !== "tool_use" || !block.id || !block.name) continue;
    calls.push({ id: block.id, name: block.name, arguments: argumentsFromInput(block.input) });
  }
  return calls;
}

async function anthropicRequest(args: {
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
        "x-api-key": args.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
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
  const res = await anthropicRequest({
    fetchImpl: fetchOf(ctx),
    url: `${base}/v1/models`,
    apiKey,
    method: "GET",
    accept: "application/json",
  });
  rejectRedirect(res);
  if (!res.ok) throw mapProviderHttpError(res.status, await errorMessage(res));
  const body = (await res.json()) as { data?: Array<{ id?: string; display_name?: string }> };
  return (body.data ?? []).flatMap((row) => {
    if (!row.id) return [];
    return row.display_name ? [{ id: row.id, label: row.display_name }] : [{ id: row.id }];
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
  const useJson = Array.isArray(args.tools);
  const mapped = toAnthropicMessages(args.messages);
  const body: Record<string, unknown> = {
    model: args.model?.trim() || config.defaultModel,
    max_tokens: MAX_TOKENS,
    messages: mapped.messages,
  };
  if (mapped.system) body.system = mapped.system;
  if (useJson && args.tools && args.tools.length > 0) body.tools = toWireTools(args.tools);
  if (!useJson) body.stream = true;

  const res = await anthropicRequest({
    fetchImpl: fetchOf(ctx),
    url: `${base}/v1/messages`,
    apiKey,
    method: "POST",
    body,
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
  yield* pipeAnthropicSse(res.body);
}

async function* readJsonMessage(res: Response): AsyncGenerator<AiChatEvent> {
  const message = (await res.json()) as AnthropicMessage;
  if (message.error?.message) throw new AiProviderError("network", message.error.message);
  const blocks = message.content ?? [];
  const text = blocks
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text ?? "")
    .join("");
  const toolCalls = readToolCalls(blocks);
  if (toolCalls.length > 0) yield { type: "tool_calls", calls: toolCalls };
  else if (text) yield { type: "delta", text };
  const usage = usageFrom(message.usage);
  if (usage) yield { type: "usage", usage };
  yield { type: "done" };
}

async function* pipeAnthropicSse(body: ReadableStream<Uint8Array>): AsyncGenerator<AiChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const toolBlocks = new Map<number, { id: string; name: string; json: string }>();

  const takeUsage = (raw: { input_tokens?: number; output_tokens?: number } | undefined) => {
    if (!raw) return;
    if (typeof raw.input_tokens === "number") inputTokens = raw.input_tokens;
    if (typeof raw.output_tokens === "number") outputTokens = raw.output_tokens;
  };

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
        let event: AnthropicStreamEvent;
        try {
          event = JSON.parse(payload) as AnthropicStreamEvent;
        } catch {
          continue;
        }
        if (event.type === "error" && event.error?.message) {
          throw new AiProviderError("network", event.error.message);
        }
        if (event.type === "message_start") takeUsage(event.message?.usage);
        if (event.type === "message_delta") takeUsage(event.usage);
        if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
          const id = event.content_block.id;
          const name = event.content_block.name;
          if (id && name && typeof event.index === "number") {
            toolBlocks.set(event.index, { id, name, json: "" });
          }
        }
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
          yield { type: "delta", text: event.delta.text };
        }
        if (
          event.type === "content_block_delta" &&
          event.delta?.type === "input_json_delta" &&
          event.delta.partial_json &&
          typeof event.index === "number"
        ) {
          const block = toolBlocks.get(event.index);
          if (block) block.json += event.delta.partial_json;
        }
      }
    }
  } catch (err) {
    if (err instanceof AiProviderError) throw err;
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new AiProviderError("network", err instanceof Error ? err.message : "Stream failed");
  }

  const calls: AiToolCall[] = [];
  for (const block of toolBlocks.values()) {
    calls.push({ id: block.id, name: block.name, arguments: block.json.trim() || "{}" });
  }
  if (calls.length > 0) yield { type: "tool_calls", calls };
  if (typeof inputTokens === "number" && typeof outputTokens === "number") {
    yield { type: "usage", usage: { inputTokens, outputTokens } };
  }
  yield { type: "done" };
}

export const plugin: AiProviderPlugin = {
  id: "anthropic",
  displayName: "Anthropic",
  version: "1.0.0",
  configSchema,
  capabilities: {
    chat: true,
    streaming: true,
    tools: true,
    embeddings: false,
    local: false,
  },
  listModels,
  verifyKey,
  streamChat,
};

export { configSchema };
