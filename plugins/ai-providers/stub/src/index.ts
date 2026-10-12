import { z } from "zod";
import {
  AiProviderError,
  publicHttpsBaseUrlSchema,
  type AiProviderPlugin,
} from "@taskmesh/ai-provider-contract";

const configSchema = z.object({
  baseUrl: publicHttpsBaseUrlSchema().default("https://stub.example.com"),
  defaultModel: z.string().trim().min(1).max(120).default("stub"),
});

/**
 * In-memory provider for the contract kit and later tests.
 * Not loaded by the app (`taskmesh.role` is `test`).
 * API-key conventions match `contractMockFetch`.
 */
export const plugin: AiProviderPlugin = {
  id: "stub",
  displayName: "Stub",
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
    if (ctx.apiKey === "bad" || !ctx.apiKey) throw new AiProviderError("auth", "invalid api key", 401);
    return [{ id: "gpt-test" }];
  },
  async verifyKey(ctx) {
    try {
      await this.listModels(ctx);
      return { ok: true };
    } catch (err) {
      if (err instanceof AiProviderError) return { ok: false, error: err };
      throw err;
    }
  },
  async *streamChat(ctx, args) {
    if (ctx.apiKey === "rate") throw new AiProviderError("rate_limit", "Rate limit reached", 429);
    if (ctx.apiKey === "quota") {
      throw new AiProviderError("quota", "You exceeded your current quota", 429);
    }
    if (ctx.apiKey === "missing-model") {
      throw new AiProviderError("model_not_found", "The model was not found", 404);
    }
    if (ctx.apiKey === "offline") throw new AiProviderError("network", "fetch failed");
    if (!ctx.apiKey || ctx.apiKey === "bad") throw new AiProviderError("auth", "invalid api key", 401);
    const last = args.messages.at(-1);
    if (last && last.role === "user" && last.content === "TOOL") {
      yield {
        type: "tool_calls",
        calls: [{ id: "call_1", name: "search_records", arguments: '{"q":"mesh"}' }],
      };
    } else {
      yield { type: "delta", text: "Hello from plugin" };
    }
    yield { type: "usage", usage: { inputTokens: 3, outputTokens: 4 } };
    yield { type: "done" };
  },
  async embed(_ctx, texts) {
    return {
      vectors: texts.map(() => [0.1, 0.2]),
      usage: { inputTokens: texts.length, outputTokens: 0 },
    };
  },
};
