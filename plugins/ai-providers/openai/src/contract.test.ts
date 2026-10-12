import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertProviderContract, registerProviderHostPolicy } from "@taskmesh/ai-provider-contract";
import { isBlockedHostname } from "../../../../src/lib/privateNet.ts";
import { configSchema, plugin } from "./index.ts";

registerProviderHostPolicy((host) => isBlockedHostname(host));

const config = {
  baseUrl: "https://api.openai.com/v1",
  defaultModel: "gpt-test",
};

describe("OpenAI provider contract", () => {
  it("passes the shared contract kit", async () => {
    await assertProviderContract(plugin, config);
  });

  it("rejects non-public base URLs", () => {
    for (const baseUrl of [
      "http://api.openai.com/v1",
      "https://127.0.0.1/v1",
      "https://169.254.169.254/",
      "https://user:pass@api.openai.com/v1",
    ]) {
      assert.equal(configSchema.safeParse({ baseUrl, defaultModel: "gpt-test" }).success, false);
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
    const events = [];
    for await (const event of plugin.streamChat(
      {
        config,
        apiKey: "good",
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
});
