import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeAiProviders,
  openAiPluginSeed,
  resolvePluginApiKey,
  selectChatPlugin,
} from "./aiProviderConfig.js";

describe("ai provider config", () => {
  it("seeds OpenAI only when the env key is set, and never stores the key", () => {
    assert.equal(openAiPluginSeed({}), null);
    const seeded = openAiPluginSeed({
      OPENAI_API_KEY: "sk-test",
      ASSISTANT_DEFAULT_MODEL: "gpt-test",
    });
    assert.deepEqual(seeded, {
      openai: {
        enabled: true,
        config: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-test" },
      },
    });
    assert.equal(JSON.stringify(seeded).includes("sk-test"), false);
  });

  it("drops malformed provider entries", () => {
    assert.deepEqual(
      normalizeAiProviders({
        openai: { enabled: true, config: { baseUrl: "https://api.openai.com/v1" } },
        bad: { enabled: "yes" },
        also: null,
      }),
      { openai: { enabled: true, config: { baseUrl: "https://api.openai.com/v1" } } },
    );
  });

  it("prefers a configured OpenAI plugin and skips plugins without a key", () => {
    const plugins = [
      { id: "openai-compatible", chat: true },
      { id: "openai", chat: true },
    ];
    const file = {
      openai: { enabled: true, config: { baseUrl: "https://api.openai.com/v1" } },
      "openai-compatible": { enabled: true, config: { baseUrl: "https://example.com/v1" } },
    };
    assert.equal(
      selectChatPlugin({
        plugins,
        file,
        hasKey: (id) => id === "openai",
        configValid: () => true,
      }),
      "openai",
    );
    assert.equal(
      selectChatPlugin({
        plugins,
        file: {
          ...file,
          openai: { enabled: false, config: file.openai.config },
        },
        hasKey: (id) => id === "openai",
        configValid: () => true,
      }),
      null,
    );
    assert.equal(
      selectChatPlugin({
        plugins,
        file: {
          openai: { enabled: false, config: {} },
          "openai-compatible": file["openai-compatible"],
        },
        hasKey: (id) => id === "openai-compatible",
        configValid: () => true,
      }),
      "openai-compatible",
    );
  });

  it("reads the OpenAI env key and no other plugin secret", () => {
    assert.equal(resolvePluginApiKey("openai", { OPENAI_API_KEY: " sk-live " }), "sk-live");
    assert.equal(resolvePluginApiKey("openai-compatible", { OPENAI_API_KEY: "sk-live" }), null);
    assert.equal(resolvePluginApiKey("anthropic", { ANTHROPIC_API_KEY: " sk-ant " }), "sk-ant");
    assert.equal(resolvePluginApiKey("anthropic", { OPENAI_API_KEY: "sk-live" }), null);
    assert.equal(resolvePluginApiKey("openai", { ANTHROPIC_API_KEY: "sk-ant" }), null);
  });

  it("keeps OpenAI ahead of an enabled Anthropic plugin", () => {
    const file = {
      anthropic: { enabled: true, config: { baseUrl: "https://api.anthropic.com" } },
      openai: { enabled: true, config: { baseUrl: "https://api.openai.com/v1" } },
    };
    assert.equal(
      selectChatPlugin({
        plugins: [
          { id: "anthropic", chat: true },
          { id: "openai", chat: true },
        ],
        file,
        hasKey: () => true,
        configValid: () => true,
      }),
      "openai",
    );
    assert.equal(
      selectChatPlugin({
        plugins: [{ id: "anthropic", chat: true }],
        file: { anthropic: file.anthropic },
        hasKey: (id) => id === "anthropic",
        configValid: () => true,
      }),
      "anthropic",
    );
  });
});
