import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertProviderContract, registerProviderHostPolicy } from "@taskmesh/ai-provider-contract";
import { isBlockedHostname } from "../../../../src/lib/privateNet.ts";
import { configSchema, plugin } from "./index.ts";

registerProviderHostPolicy((host) => isBlockedHostname(host));

const config = {
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  defaultModel: "gemini-3.8-flash",
};

describe("Gemini provider contract", () => {
  it("passes the shared contract kit", async () => {
    await assertProviderContract(plugin, config);
  });

  it("rejects non-public base URLs", () => {
    for (const baseUrl of [
      "http://generativelanguage.googleapis.com",
      "https://127.0.0.1",
      "https://169.254.169.254/",
      "https://user:pass@generativelanguage.googleapis.com",
    ]) {
      assert.equal(configSchema.safeParse({ baseUrl, defaultModel: "gemini-3.8-flash" }).success, false);
    }
  });

  it("streams SSE deltas when tools are omitted", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":2}}\n\n',
          ),
        );
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
            apiKey: headers.get("x-goog-api-key"),
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
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse",
    );
    assert.equal(seen?.apiKey, "good");
    assert.deepEqual(seen?.body.generationConfig, { thinkingConfig: { thinkingLevel: "low" } });
    assert.equal(events.some((event) => event.type === "delta" && event.text === "Hi"), true);
    const usage = events.find((event) => event.type === "usage");
    assert.equal(usage?.type, "usage");
    if (usage?.type === "usage") {
      assert.equal(usage.usage.inputTokens, 1);
      assert.equal(usage.usage.outputTokens, 2);
    }
    assert.equal(events.at(-1)?.type, "done");
  });

  it("maps system text, tools, and tool results onto generateContent", async () => {
    let body: Record<string, unknown> = {};
    let url = "";
    const events = [];
    for await (const event of plugin.streamChat(
      {
        config,
        apiKey: "good",
        fetchImpl: async (input, init) => {
          url = String(input);
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: "ok" }] } }],
              usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
      {
        messages: [
          { role: "system", content: "Be brief" },
          { role: "user", content: "Find mesh" },
          {
            role: "assistant",
            content: null,
            toolCalls: [{ id: "call_1", name: "search_records", arguments: '{"q":"mesh"}' }],
          },
          { role: "tool", toolCallId: "call_1", content: "found" },
        ],
        tools: [
          {
            name: "search_records",
            description: "Search",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        ],
      },
    )) {
      events.push(event);
    }
    assert.equal(
      url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    );
    assert.deepEqual(body.systemInstruction, { parts: [{ text: "Be brief" }] });
    assert.deepEqual(body.tools, [
      {
        functionDeclarations: [
          {
            name: "search_records",
            description: "Search",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        ],
      },
    ]);
    const contents = body.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    const model = contents[1];
    assert.equal(model?.role, "model");
    assert.deepEqual(model?.parts[0]?.functionCall, { name: "search_records", args: { q: "mesh" } });
    const result = contents[2]?.parts[0]?.functionResponse as { name?: string; response?: { result?: string } };
    assert.equal(result?.name, "search_records");
    assert.deepEqual(result?.response, { result: "found" });
    assert.equal(events.some((event) => event.type === "delta" && event.text === "ok"), true);
  });

  it("embeds texts with the fixed embedding model", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    const embedded = await plugin.embed!(
      {
        config,
        apiKey: "good",
        fetchImpl: async (input, init) => {
          url = String(input);
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              embeddings: [{ values: [0.25, 0.5] }, { values: [0.75] }],
              usageMetadata: { totalTokenCount: 6 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
      ["alpha", "beta"],
    );
    assert.equal(
      url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents",
    );
    assert.deepEqual(body.requests, [
      { model: "models/gemini-embedding-001", content: { parts: [{ text: "alpha" }] } },
      { model: "models/gemini-embedding-001", content: { parts: [{ text: "beta" }] } },
    ]);
    assert.deepEqual(embedded.vectors, [[0.25, 0.5], [0.75]]);
    assert.deepEqual(embedded.usage, { inputTokens: 6, outputTokens: 0 });
  });
});
