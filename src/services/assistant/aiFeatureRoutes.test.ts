import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AiProviderError, type AiProviderPlugin } from "@taskmesh/ai-provider-contract";
import type { AiAuditInput } from "./aiAudit.js";
import {
  AI_FEATURES,
  followRouteAttempts,
  isRoutablePin,
  planAiRoute,
  type AiFeatureRoutesFile,
  type RoutePlugin,
} from "./aiFeatureRoutes.js";
import { runAssistantWithTools } from "./runWithTools.js";

const EMPTY: AiFeatureRoutesFile = { features: {}, profiles: [] };

const OPENAI: RoutePlugin = {
  id: "openai",
  chat: true,
  tools: true,
  embeddings: true,
  local: false,
  enabled: true,
  configValid: true,
  hasKey: true,
  configuredModel: "gpt-4.1-mini",
  userModel: null,
};

const ANTHROPIC: RoutePlugin = {
  id: "anthropic",
  chat: true,
  tools: true,
  embeddings: false,
  local: false,
  enabled: true,
  configValid: true,
  hasKey: true,
  configuredModel: "claude-sonnet-4-5",
  userModel: null,
};

const OLLAMA: RoutePlugin = {
  id: "ollama",
  chat: true,
  tools: true,
  embeddings: true,
  local: true,
  enabled: true,
  configValid: true,
  hasKey: false,
  configuredModel: "llama3.2",
  userModel: null,
};

const FILE = {
  openai: { enabled: true, config: {} },
  anthropic: { enabled: true, config: {} },
  ollama: { enabled: true, config: {} },
};

function plugin(fail: boolean): AiProviderPlugin {
  return {
    id: fail ? "openai" : "anthropic",
    displayName: fail ? "OpenAI" : "Anthropic",
    version: "0.0.0",
    configSchema: { safeParse: () => ({ success: true as const, data: {} }) } as unknown as AiProviderPlugin["configSchema"],
    capabilities: { chat: true, streaming: true, tools: true, embeddings: false, local: false },
    listModels: async () => [],
    verifyKey: async () => ({ ok: true }),
    async *streamChat() {
      if (fail) throw new AiProviderError("rate_limit", "slow down", 429);
      yield { type: "delta", text: "ok" };
      yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
      yield { type: "done" };
    },
  };
}

describe("model routing", () => {
  it("never routes a tool feature to a model marked without tool use", () => {
    const routes: AiFeatureRoutesFile = {
      features: {
        assistant: {
          default: { pluginId: "openai", model: "gpt-4.1-mini" },
          fallbacks: [],
        },
      },
      profiles: [{ pluginId: "openai", model: "gpt-4.1-mini", tools: false }],
    };
    const planned = planAiRoute({
      feature: AI_FEATURES.assistant!,
      plugins: [OPENAI, ANTHROPIC],
      routes,
      userPin: { pluginId: "openai", model: "gpt-4.1-mini" },
      providersFile: FILE,
      loaderOrder: ["openai", "anthropic"],
    });
    assert.equal(planned.attempts.some((row) => row.model === "gpt-4.1-mini"), false);
    assert.equal(planned.skipped.some((row) => row.reason === "capability_mismatch"), true);
    assert.equal(planned.attempts[0]?.model, "claude-sonnet-4-5");
    assert.equal(
      isRoutablePin({
        feature: AI_FEATURES.assistant!,
        plugin: OPENAI,
        model: "gpt-4.1-mini",
        routes,
      }),
      false,
    );
  });

  it("lets a user pin win over the administrator default", () => {
    const planned = planAiRoute({
      feature: AI_FEATURES.assistant!,
      plugins: [OPENAI, ANTHROPIC],
      routes: {
        features: {
          assistant: { default: { pluginId: "openai", model: "gpt-4.1" }, fallbacks: [] },
        },
        profiles: [],
      },
      userPin: { pluginId: "anthropic", model: "claude-sonnet-4-5" },
      providersFile: FILE,
      loaderOrder: ["openai", "anthropic"],
    });
    assert.equal(planned.attempts[0]?.pluginId, "anthropic");
    assert.equal(planned.attempts[0]?.reason, "user");
    assert.equal(planned.attempts[1]?.reason, "admin");
  });

  it("uses a user's per-plugin model even when that id is not in the catalog", () => {
    const planned = planAiRoute({
      feature: AI_FEATURES.assistant!,
      plugins: [{ ...OPENAI, userModel: "gpt-user" }],
      routes: EMPTY,
      userPin: null,
      providersFile: FILE,
      loaderOrder: ["openai"],
    });
    assert.equal(planned.attempts[0]?.model, "gpt-user");
    assert.equal(planned.attempts[0]?.profile.tools, true);
  });

  it("does not use an unknown model for a tool feature, and keeps the configured default", () => {
    const planned = planAiRoute({
      feature: AI_FEATURES.assistant!,
      plugins: [OPENAI],
      routes: EMPTY,
      userPin: { pluginId: "openai", model: "mystery-model" },
      providersFile: FILE,
      loaderOrder: ["openai"],
    });
    assert.equal(planned.attempts.some((row) => row.model === "mystery-model"), false);
    assert.equal(planned.skipped[0]?.reason, "capability_mismatch");
    assert.equal(planned.attempts[0]?.model, "gpt-4.1-mini");
    assert.equal(planned.attempts[0]?.reason, "automatic");
  });

  it("keeps an Ollama install whose configured model is not in the catalog", () => {
    const planned = planAiRoute({
      feature: AI_FEATURES.assistant!,
      plugins: [OLLAMA],
      routes: EMPTY,
      userPin: null,
      providersFile: FILE,
      loaderOrder: ["ollama"],
    });
    assert.equal(planned.attempts[0]?.model, "llama3.2");
    assert.equal(planned.attempts[0]?.local, true);
  });

  it("does not fall through from a local model to a cloud model when local-only", async () => {
    const planned = planAiRoute({
      feature: AI_FEATURES.assistant!,
      plugins: [OPENAI, OLLAMA],
      routes: EMPTY,
      userPin: null,
      localOnly: true,
      providersFile: FILE,
      loaderOrder: ["openai", "ollama"],
    });
    assert.equal(planned.attempts.every((row) => row.local), true);
    assert.equal(planned.skipped.some((row) => row.pluginId === "openai" && row.reason === "local_only"), true);
    let cloudCalls = 0;
    await assert.rejects(
      () =>
        followRouteAttempts({
          attempts: planned.attempts,
          onDeny: async () => undefined,
          call: async (attempt) => {
            if (!attempt.local) cloudCalls += 1;
            throw new AiProviderError("rate_limit", "ollama busy", 429);
          },
        }),
      (err: unknown) => err instanceof AiProviderError && err.code === "rate_limit",
    );
    assert.equal(cloudCalls, 0);
  });

  it("records a route deny then a route allow when the first provider is rate-limited", async () => {
    const rows: AiAuditInput[] = [];
    const planned = planAiRoute({
      feature: AI_FEATURES.assistant!,
      plugins: [{ ...OPENAI, configuredModel: "gpt-4.1" }, ANTHROPIC],
      routes: {
        features: {
          assistant: {
            default: { pluginId: "openai", model: "gpt-4.1" },
            fallbacks: [{ pluginId: "anthropic", model: "claude-sonnet-4-5" }],
          },
        },
        profiles: [],
      },
      userPin: null,
      providersFile: FILE,
      loaderOrder: ["openai", "anthropic"],
    });
    assert.equal(planned.attempts[0]?.model, "gpt-4.1");
    assert.equal(planned.attempts[1]?.reason, "fallback:0");
    await followRouteAttempts({
      attempts: planned.attempts,
      onDeny: async (attempt, code) => {
        rows.push({
          feature: "assistant",
          provider: attempt.pluginId,
          model: attempt.model,
          action: "route",
          decision: "deny",
          reason: code,
          tier: 0,
        });
      },
      call: async (attempt) => {
        await runAssistantWithTools({
          plugin: plugin(attempt.pluginId === "openai"),
          apiKey: "test",
          config: {},
          messages: [{ role: "user", content: "hello" }],
          model: attempt.model,
          actorUserId: 1,
          isAdministrator: false,
          assertBaseUrl: async (url) => url,
          rethrowFirstProviderError: true,
          routeReason: attempt.reason,
          auditSink: async (row) => {
            rows.push(row);
          },
          handlers: {
            onDelta: () => undefined,
            onDone: () => undefined,
            onError: (message) => {
              throw new Error(message);
            },
          },
        });
      },
    });
    const routeRows = rows.filter((row) => row.action === "route");
    assert.equal(routeRows[0]?.decision, "deny");
    assert.equal(routeRows[0]?.reason, "rate_limit");
    assert.equal(routeRows[0]?.model, "gpt-4.1");
    assert.equal(routeRows[1]?.decision, "allow");
    assert.equal(routeRows[1]?.model, "claude-sonnet-4-5");
    assert.equal(routeRows[1]?.reason, "fallback:0");
    assert.equal(routeRows.every((row) => row.promptId == null && row.promptRef == null), true);
    assert.equal(JSON.stringify(routeRows).includes("hello"), false);
  });
});
