import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertProviderContract, registerProviderHostPolicy } from "@taskmesh/ai-provider-contract";
import { isBlockedHostname } from "../../../../src/lib/privateNet.ts";
import { configSchema, plugin } from "./index.ts";

registerProviderHostPolicy((host) => isBlockedHostname(host));

const config = {
  baseUrl: "https://api.anthropic.com",
  defaultModel: "claude-sonnet-4-5",
};

describe("Anthropic provider contract", () => {
  it("passes the shared contract kit", async () => {
    await assertProviderContract(plugin, config);
  });

  it("rejects non-public base URLs", () => {
    for (const baseUrl of [
      "http://api.anthropic.com",
      "https://127.0.0.1",
      "https://169.254.169.254/",
      "https://user:pass@api.anthropic.com",
    ]) {
      assert.equal(configSchema.safeParse({ baseUrl, defaultModel: "claude-sonnet-4-5" }).success, false);
    }
  });

  it("streams SSE deltas when tools are omitted", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
        controller.close();
      },
    });
    let seen: { url: string; apiKey: string | null; version: string | null; body: Record<string, unknown> } | null =
      null;
    const events = [];
    for await (const event of plugin.streamChat(
      {
        config,
        apiKey: "good",
        fetchImpl: async (input, init) => {
          const headers = new Headers(init?.headers);
          seen = {
            url: String(input),
            apiKey: headers.get("x-api-key"),
            version: headers.get("anthropic-version"),
            body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          };
          return new Response(stream, { status: 200 });
        },
      },
      { messages: [{ role: "user", content: "Hi" }] },
    )) {
      events.push(event);
    }
    assert.equal(seen?.url, "https://api.anthropic.com/v1/messages");
    assert.equal(seen?.apiKey, "good");
    assert.equal(seen?.version, "2023-06-01");
    assert.equal(seen?.body.stream, true);
    assert.equal(seen?.body.model, "claude-sonnet-4-5");
    assert.equal(events.some((event) => event.type === "delta" && event.text === "Hi"), true);
    const usage = events.find((event) => event.type === "usage");
    assert.equal(usage?.type, "usage");
    if (usage?.type === "usage") {
      assert.equal(usage.usage.inputTokens, 1);
      assert.equal(usage.usage.outputTokens, 2);
    }
    assert.equal(events.at(-1)?.type, "done");
  });

  it("maps system text, tools, and tool results onto the Messages API", async () => {
    let body: Record<string, unknown> = {};
    const events = [];
    for await (const event of plugin.streamChat(
      {
        config,
        apiKey: "good",
        fetchImpl: async (_input, init) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              content: [{ type: "text", text: "ok" }],
              usage: { input_tokens: 1, output_tokens: 1 },
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
    assert.equal(body.system, "Be brief");
    assert.equal(body.stream, undefined);
    assert.equal(body.max_tokens, 8192);
    assert.deepEqual(body.tools, [
      {
        name: "search_records",
        description: "Search",
        input_schema: { type: "object", properties: { q: { type: "string" } } },
      },
    ]);
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const assistant = messages[1];
    assert.equal(assistant?.role, "assistant");
    const toolUse = (assistant?.content as Array<{ type?: string; input?: { q?: string } }>)[0];
    assert.equal(toolUse?.type, "tool_use");
    assert.deepEqual(toolUse?.input, { q: "mesh" });
    const result = (messages[2]?.content as Array<{ type?: string; tool_use_id?: string; content?: string }>)[0];
    assert.equal(result?.type, "tool_result");
    assert.equal(result?.tool_use_id, "call_1");
    assert.equal(result?.content, "found");
    assert.equal(events.some((event) => event.type === "delta" && event.text === "ok"), true);
  });
});
