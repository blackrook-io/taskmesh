import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AiProviderError,
  assertProviderContract,
  registerProviderHostPolicy,
} from "@taskmesh/ai-provider-contract";
import { isBlockedHostname } from "../../../../src/lib/privateNet.ts";
import { configSchema, plugin } from "./index.ts";

registerProviderHostPolicy((host) => isBlockedHostname(host));

const config = {
  baseUrl: "http://127.0.0.1:11434",
  defaultModel: "llama3.2",
  embeddingModel: "nomic-embed-text",
};

describe("Ollama provider contract", () => {
  it("passes the shared contract kit", async () => {
    await assertProviderContract(plugin, config);
  });

  it("allows private http base URLs and rejects metadata addresses", () => {
    assert.equal(configSchema.safeParse(config).success, true);
    assert.equal(
      configSchema.safeParse({ ...config, baseUrl: "http://192.168.1.20:11434" }).success,
      true,
    );
    assert.equal(
      configSchema.safeParse({ ...config, baseUrl: "http://10.1.2.3:11434" }).success,
      true,
    );
    for (const baseUrl of [
      "http://169.254.169.254/",
      "http://metadata.google.internal/",
      "http://user:pass@127.0.0.1:11434",
      "file:///tmp/ollama",
    ]) {
      assert.equal(configSchema.safeParse({ ...config, baseUrl }).success, false);
    }
  });

  it("checks health and lists models without an API key", async () => {
    const ctx = { config, apiKey: null, fetchImpl: async (input: string) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "llama3.2" }] }), { status: 200 });
      }
      return new Response("Ollama is running", { status: 200 });
    } };
    const verified = await plugin.verifyKey(ctx);
    assert.equal(verified.ok, true);
    const models = await plugin.listModels(ctx);
    assert.deepEqual(models, [{ id: "llama3.2" }]);
  });

  it("streams NDJSON deltas", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('{"message":{"role":"assistant","content":"Hi"},"done":false}\n'),
        );
        controller.enqueue(
          encoder.encode(
            '{"message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":1,"eval_count":2}\n',
          ),
        );
        controller.close();
      },
    });
    const events = [];
    for await (const event of plugin.streamChat(
      {
        config,
        apiKey: null,
        fetchImpl: async () => new Response(stream, { status: 200 }),
      },
      { messages: [{ role: "user", content: "Hi" }] },
    )) {
      events.push(event);
    }
    assert.equal(events.some((event) => event.type === "delta" && event.text === "Hi"), true);
    assert.equal(events.some((event) => event.type === "usage"), true);
    assert.equal(events.at(-1)?.type, "done");
  });

  it("reports a missing model and a stopped server", async () => {
    await assert.rejects(
      () =>
        plugin.listModels({
          config,
          apiKey: null,
          fetchImpl: async () =>
            new Response(JSON.stringify({ error: "model 'llama3.2' not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }),
        }),
      (err: unknown) =>
        err instanceof AiProviderError &&
        err.code === "model_not_found" &&
        err.message.includes("not found"),
    );
    await assert.rejects(
      () =>
        plugin.listModels({
          config,
          apiKey: null,
          fetchImpl: async () => {
            throw new TypeError("fetch failed");
          },
        }),
      (err: unknown) =>
        err instanceof AiProviderError &&
        err.code === "network" &&
        err.message.includes("http://127.0.0.1:11434"),
    );
  });
});
