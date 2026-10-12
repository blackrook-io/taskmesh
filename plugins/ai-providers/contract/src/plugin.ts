import type { ZodType } from "zod";
import {
  listOpenAiModels,
  streamOpenAiCompatibleChat,
  verifyOpenAiKey,
} from "./openaiWire.js";
import type {
  AiProviderContext,
  AiProviderPlugin,
  OpenAiCompatibleConfig,
  ProviderFetch,
} from "./types.js";

const CHAT_CAPABILITIES = {
  chat: true,
  streaming: true,
  tools: true,
  embeddings: false,
  local: false,
} as const;

function asConfig(schema: ZodType, config: unknown): OpenAiCompatibleConfig {
  const parsed = schema.parse(config) as OpenAiCompatibleConfig;
  return parsed;
}

function fetchOf(ctx: AiProviderContext): ProviderFetch {
  return ctx.fetchImpl ?? ((input, init) => fetch(input, init));
}

export function createOpenAiCompatiblePlugin(spec: {
  id: string;
  displayName: string;
  version: string;
  configSchema: ZodType;
}): AiProviderPlugin {
  return {
    id: spec.id,
    displayName: spec.displayName,
    version: spec.version,
    configSchema: spec.configSchema,
    capabilities: CHAT_CAPABILITIES,
    async listModels(ctx) {
      const config = asConfig(spec.configSchema, ctx.config);
      return listOpenAiModels({
        fetchImpl: fetchOf(ctx),
        baseUrl: config.baseUrl,
        apiKey: ctx.apiKey,
        assertBaseUrl: ctx.assertBaseUrl,
      });
    },
    verifyKey(ctx) {
      const config = asConfig(spec.configSchema, ctx.config);
      return verifyOpenAiKey({
        fetchImpl: fetchOf(ctx),
        baseUrl: config.baseUrl,
        apiKey: ctx.apiKey,
        assertBaseUrl: ctx.assertBaseUrl,
      });
    },
    streamChat(ctx, args) {
      const config = asConfig(spec.configSchema, ctx.config);
      return streamOpenAiCompatibleChat({
        fetchImpl: fetchOf(ctx),
        baseUrl: config.baseUrl,
        apiKey: ctx.apiKey,
        model: args.model?.trim() || config.defaultModel,
        messages: args.messages,
        tools: args.tools,
        signal: args.signal,
        assertBaseUrl: ctx.assertBaseUrl,
      });
    },
  };
}
