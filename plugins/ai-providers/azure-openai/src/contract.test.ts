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
  baseUrl: "https://example.openai.azure.com",
  chatDeployment: "chat-deploy",
  embeddingsDeployment: "embed-deploy",
  apiVersion: "2024-10-21",
};

describe("Azure OpenAI provider contract", () => {
  it("passes the shared contract kit", async () => {
    await assertProviderContract(plugin, config);
  });

  it("rejects non-public base URLs", () => {
    for (const baseUrl of [
      "http://example.openai.azure.com",
      "https://127.0.0.1",
      "https://169.254.169.254/",
      "https://user:pass@example.openai.azure.com",
      "https://example.openai.azure.com/openai",
    ]) {
      assert.equal(
        configSchema.safeParse({ ...config, baseUrl }).success,
        false,
        baseUrl,
      );
    }
  });

  it("streams SSE deltas when tools are omitted", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
        controller.enqueue(
          encoder.encode('data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n'),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    let seen: { url: string; apiKey: string | null; body: Record<string, unknown> } | null = null;
    const events = [];
    for await (const event of plugin.streamChat(
      {
        config,
        apiKey: "good",
        fetchImpl: async (input, init) => {
          const headers = new Headers(init?.headers);
          seen = {
            url: String(input),
            apiKey: headers.get("api-key"),
            body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          };
          return new Response(stream, { status: 200 });
        },
      },
      { messages: [{ role: "user", content: "Hi" }] },
    )) {
      events.push(event);
    }
    assert.equal(
      seen?.url,
      "https://example.openai.azure.com/openai/deployments/chat-deploy/chat/completions?api-version=2024-10-21",
    );
    assert.equal(seen?.apiKey, "good");
    assert.equal(seen?.body.model, "chat-deploy");
    assert.equal(seen?.body.stream, true);
    assert.equal(events.some((event) => event.type === "delta" && event.text === "Hi"), true);
    const usage = events.find((event) => event.type === "usage");
    assert.equal(usage?.type, "usage");
    if (usage?.type === "usage") {
      assert.equal(usage.usage.inputTokens, 1);
      assert.equal(usage.usage.outputTokens, 2);
    }
    assert.equal(events.at(-1)?.type, "done");
  });

  it("embeds with the embeddings deployment", async () => {
    let seen: { url: string; apiKey: string | null; body: unknown } | null = null;
    const result = await plugin.embed!(
      {
        config,
        apiKey: "good",
        fetchImpl: async (input, init) => {
          const headers = new Headers(init?.headers);
          seen = {
            url: String(input),
            apiKey: headers.get("api-key"),
            body: JSON.parse(String(init?.body)),
          };
          return new Response(
            JSON.stringify({
              data: [{ embedding: [0.25, 0.5], index: 0 }],
              usage: { prompt_tokens: 6 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
      ["hello"],
    );
    assert.equal(
      seen?.url,
      "https://example.openai.azure.com/openai/deployments/embed-deploy/embeddings?api-version=2024-10-21",
    );
    assert.equal(seen?.apiKey, "good");
    assert.deepEqual(seen?.body, { input: ["hello"] });
    assert.deepEqual(result.vectors, [[0.25, 0.5]]);
    assert.deepEqual(result.usage, { inputTokens: 6, outputTokens: 0 });

    await assert.rejects(
      () =>
        plugin.embed!(
          {
            config: { ...config, embeddingsDeployment: "" },
            apiKey: "good",
            fetchImpl: async () => {
              throw new Error("should not fetch");
            },
          },
          ["hello"],
        ),
      (err: unknown) => err instanceof AiProviderError && err.code === "invalid_config",
    );
  });
});
