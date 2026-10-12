import type { ZodType } from "zod";

export type AiProviderErrorCode =
  | "auth"
  | "rate_limit"
  | "quota"
  | "model_not_found"
  | "network"
  | "invalid_config"
  | "unsupported";

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly status?: number;

  constructor(code: AiProviderErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.status = status;
  }
}

/** Rejected Administrator config. `status` and `code` match the API error helper. */
export class ProviderConfigError extends Error {
  readonly status = 400;
  readonly code = "invalid_provider_config";

  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type AiToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AiToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type AiChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: AiToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type AiChatEvent =
  | { type: "delta"; text: string }
  | { type: "tool_calls"; calls: AiToolCall[] }
  | { type: "usage"; usage: AiUsage }
  | { type: "done" };

export type AiProviderCapabilities = {
  chat: boolean;
  streaming: boolean;
  tools: boolean;
  embeddings: boolean;
  local: boolean;
};

export type ProviderFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type AiProviderContext = {
  config: unknown;
  apiKey: string | null;
  fetchImpl?: ProviderFetch;
  /** Full public-https check, including DNS, supplied by the app. */
  assertBaseUrl?: (url: string) => Promise<string>;
};

export type AiProviderPlugin = {
  id: string;
  displayName: string;
  version: string;
  configSchema: ZodType;
  capabilities: AiProviderCapabilities;
  listModels(ctx: AiProviderContext): Promise<Array<{ id: string; label?: string }>>;
  verifyKey(ctx: AiProviderContext): Promise<{ ok: true } | { ok: false; error: AiProviderError }>;
  streamChat(
    ctx: AiProviderContext,
    args: {
      messages: AiChatMessage[];
      tools?: AiToolDefinition[];
      model?: string;
      signal?: AbortSignal;
    },
  ): AsyncIterable<AiChatEvent>;
  embed?(
    ctx: AiProviderContext,
    texts: string[],
  ): Promise<{ vectors: number[][]; usage?: AiUsage }>;
};

export type OpenAiCompatibleConfig = {
  baseUrl: string;
  defaultModel: string;
};
