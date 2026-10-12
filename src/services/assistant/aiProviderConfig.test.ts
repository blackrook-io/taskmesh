import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  configuredChatModel,
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
    assert.equal(resolvePluginApiKey("gemini", { GEMINI_API_KEY: " sk-gem " }), "sk-gem");
    assert.equal(resolvePluginApiKey("gemini", { OPENAI_API_KEY: "sk-live" }), null);
    assert.equal(resolvePluginApiKey("openai", { GEMINI_API_KEY: "sk-gem" }), null);
    assert.equal(resolvePluginApiKey("azure-openai", { AZURE_OPENAI_API_KEY: " azure-key " }), "azure-key");
    assert.equal(resolvePluginApiKey("azure-openai", { OPENAI_API_KEY: "sk-live" }), null);
    assert.equal(resolvePluginApiKey("openai", { AZURE_OPENAI_API_KEY: "azure-key" }), null);
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

  it("keeps OpenAI ahead of an enabled Gemini plugin", () => {
    const file = {
      gemini: { enabled: true, config: { baseUrl: "https://generativelanguage.googleapis.com/v1beta" } },
      openai: { enabled: true, config: { baseUrl: "https://api.openai.com/v1" } },
    };
    assert.equal(
      selectChatPlugin({
        plugins: [
          { id: "gemini", chat: true },
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
        plugins: [
          { id: "anthropic", chat: true },
          { id: "gemini", chat: true },
        ],
        file: {
          anthropic: { enabled: true, config: { baseUrl: "https://api.anthropic.com" } },
          gemini: file.gemini,
        },
        hasKey: () => true,
        configValid: () => true,
      }),
      "anthropic",
    );
  });

  it("keeps OpenAI ahead of an enabled Azure OpenAI plugin", () => {
    const file = {
      "azure-openai": {
        enabled: true,
        config: { baseUrl: "https://example.openai.azure.com", chatDeployment: "chat" },
      },
      openai: { enabled: true, config: { baseUrl: "https://api.openai.com/v1" } },
    };
    assert.equal(
      selectChatPlugin({
        plugins: [
          { id: "azure-openai", chat: true },
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
        plugins: [{ id: "azure-openai", chat: true }],
        file: { "azure-openai": file["azure-openai"] },
        hasKey: (id) => id === "azure-openai",
        configValid: () => true,
      }),
      "azure-openai",
    );
  });

  it("selects a local plugin without a key and still prefers OpenAI", () => {
    const file = {
      ollama: {
        enabled: true,
        config: { baseUrl: "http://127.0.0.1:11434", defaultModel: "llama3.2" },
      },
      openai: { enabled: true, config: { baseUrl: "https://api.openai.com/v1" } },
    };
    assert.equal(
      selectChatPlugin({
        plugins: [
          { id: "ollama", chat: true, local: true },
          { id: "openai", chat: true },
        ],
        file,
        hasKey: (id) => id === "openai",
        configValid: () => true,
      }),
      "openai",
    );
    assert.equal(
      selectChatPlugin({
        plugins: [{ id: "ollama", chat: true, local: true }],
        file: { ollama: file.ollama },
        hasKey: () => false,
        configValid: () => true,
      }),
      "ollama",
    );
    assert.equal(
      selectChatPlugin({
        plugins: [{ id: "ollama", chat: true, local: true }],
        file: { ollama: { enabled: true, config: {} } },
        hasKey: () => false,
        configValid: () => false,
      }),
      null,
    );
  });

  it("uses the Azure chat deployment when no default model is set", () => {
    assert.equal(configuredChatModel({ defaultModel: " gpt-4.1-mini " }), "gpt-4.1-mini");
    assert.equal(configuredChatModel({ chatDeployment: " my-deploy " }), "my-deploy");
    assert.equal(
      configuredChatModel({ defaultModel: "gpt-4.1-mini", chatDeployment: "my-deploy" }),
      "gpt-4.1-mini",
    );
    assert.equal(configuredChatModel({}), null);
  });
});
