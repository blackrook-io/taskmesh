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

const endpointSchema = publicHttpsBaseUrlSchema().superRefine((value, ctx) => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return;
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path || url.search || url.hash) {
    ctx.addIssue({
      code: "custom",
      message: "Endpoint must be the resource host only",
    });
  }
});

const configSchema = z.object({
  baseUrl: endpointSchema,
  chatDeployment: z.string().trim().min(1).max(120),
  embeddingsDeployment: z.string().trim().max(120).default(""),
  apiVersion: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "API version must be YYYY-MM-DD")
    .default("2024-10-21"),
});

type AzureConfig = z.infer<typeof configSchema>;

type AzureToolCall = {
  id?: string;
  function?: { name?: string; arguments?: string };
};

type AzureMessage = {
  content?: string | null;
  tool_calls?: AzureToolCall[];
};

type AzureCompletion = {
  choices?: Array<{ message?: AzureMessage }>;
  data?: Array<{ id?: string; embedding?: number[]; index?: number }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string };
};

type AzureChunk = {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string };
};

function readConfig(config: unknown): AzureConfig {
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
    const body = (await res.json()) as AzureCompletion;
    return body.error?.message || body.error?.code || res.statusText || "Provider request failed";
  } catch {
    return res.statusText || "Provider request failed";
  }
}

function chatUsage(raw: AzureCompletion["usage"]): AiUsage | null {
  if (!raw) return null;
  if (typeof raw.prompt_tokens !== "number" || typeof raw.completion_tokens !== "number") return null;
  return { inputTokens: raw.prompt_tokens, outputTokens: raw.completion_tokens };
}

function embedUsage(raw: AzureCompletion["usage"]): AiUsage | undefined {
  if (!raw || typeof raw.prompt_tokens !== "number") return undefined;
  return { inputTokens: raw.prompt_tokens, outputTokens: 0 };
}

function deploymentOf(config: AzureConfig, model: string | undefined): string {
  const named = model?.trim();
  return named || config.chatDeployment;
}

function azureUrl(base: string, path: string, apiVersion: string): string {
  const version = encodeURIComponent(apiVersion);
  return `${base}${path}?api-version=${version}`;
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

function readToolCalls(message: AzureMessage | undefined): AiToolCall[] {
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

async function azureFetch(args: {
  fetchImpl: ProviderFetch;
  url: string;
  apiKey: string;
  method: "GET" | "POST";
  body?: unknown;
  accept: string;
  signal?: AbortSignal;
}): Promise<Response> {
  try {
    return await args.fetchImpl(args.url, {
      method: args.method,
      headers: {
        "api-key": args.apiKey,
        Accept: args.accept,
        ...(args.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
      redirect: "manual",
      signal: args.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    const message = err instanceof Error ? err.message : "Failed to reach provider";
    throw new AiProviderError("network", message);
  }
}

async function listDeployments(ctx: AiProviderContext): Promise<Array<{ id: string }>> {
  const config = readConfig(ctx.config);
  const apiKey = requireKey(ctx.apiKey);
  const base = await resolveBase(config.baseUrl, ctx.assertBaseUrl);
  const res = await azureFetch({
    fetchImpl: fetchOf(ctx),
    url: azureUrl(base, "/openai/deployments", config.apiVersion),
    apiKey,
    method: "GET",
    accept: "application/json",
  });
  rejectRedirect(res);
  if (!res.ok) throw mapProviderHttpError(res.status, await errorMessage(res));
  const body = (await res.json()) as AzureCompletion;
  return (body.data ?? []).flatMap((row) => (row.id ? [{ id: row.id }] : []));
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
  const deployment = deploymentOf(config, args.model);
  const useJson = Array.isArray(args.tools);
  const body: Record<string, unknown> = {
    model: deployment,
    messages: args.messages.map(toWireMessage),
  };
  if (useJson) {
    body.tools = toWireTools(args.tools ?? []);
    body.tool_choice = "auto";
  } else {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  const res = await azureFetch({
    fetchImpl: fetchOf(ctx),
    url: azureUrl(
      base,
      `/openai/deployments/${encodeURIComponent(deployment)}/chat/completions`,
      config.apiVersion,
    ),
    apiKey,
    method: "POST",
    body,
    accept: useJson ? "application/json" : "text/event-stream",
    signal: args.signal,
  });
  rejectRedirect(res);
  if (!res.ok) throw mapProviderHttpError(res.status, await errorMessage(res));

  if (useJson) {
    const completion = (await res.json()) as AzureCompletion;
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
    const usage = chatUsage(completion.usage);
    if (usage) yield { type: "usage", usage };
    yield { type: "done" };
    return;
  }

  if (!res.body) throw new AiProviderError("network", "Provider returned an empty stream");
  yield* pipeSse(res.body);
}

async function* pipeSse(body: ReadableStream<Uint8Array>): AsyncGenerator<AiChatEvent> {
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
        let parsed: AzureChunk;
        try {
          parsed = JSON.parse(payload) as AzureChunk;
        } catch {
          continue;
        }
        if (parsed.error?.message) {
          throw mapProviderHttpError(0, parsed.error.message);
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield { type: "delta", text: delta };
        const nextUsage = chatUsage(parsed.usage);
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

async function embed(
  ctx: AiProviderContext,
  texts: string[],
): Promise<{ vectors: number[][]; usage?: AiUsage }> {
  const config = readConfig(ctx.config);
  const deployment = config.embeddingsDeployment.trim();
  if (!deployment) {
    throw new AiProviderError("invalid_config", "Embeddings deployment is not configured");
  }
  const apiKey = requireKey(ctx.apiKey);
  const base = await resolveBase(config.baseUrl, ctx.assertBaseUrl);
  const res = await azureFetch({
    fetchImpl: fetchOf(ctx),
    url: azureUrl(
      base,
      `/openai/deployments/${encodeURIComponent(deployment)}/embeddings`,
      config.apiVersion,
    ),
    apiKey,
    method: "POST",
    body: { input: texts },
    accept: "application/json",
  });
  rejectRedirect(res);
  if (!res.ok) throw mapProviderHttpError(res.status, await errorMessage(res));
  const body = (await res.json()) as AzureCompletion;
  const rows = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectors = rows.flatMap((row) => (row.embedding ? [row.embedding] : []));
  if (vectors.length !== texts.length) {
    throw new AiProviderError("network", "Embeddings response did not match the input");
  }
  return { vectors, usage: embedUsage(body.usage) };
}

export const plugin: AiProviderPlugin = {
  id: "azure-openai",
  displayName: "Azure OpenAI",
  version: "1.0.0",
  configSchema,
  capabilities: {
    chat: true,
    streaming: true,
    tools: true,
    embeddings: true,
    local: false,
  },
  listModels: listDeployments,
  async verifyKey(ctx) {
    try {
      await listDeployments(ctx);
      return { ok: true };
    } catch (err) {
      if (err instanceof AiProviderError) return { ok: false, error: err };
      throw err;
    }
  },
  streamChat,
  embed,
};

export { configSchema };
