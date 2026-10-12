import assert from "node:assert/strict";
import type { AiProviderContext, AiProviderPlugin, ProviderFetch } from "./types.js";
import { AiProviderError } from "./types.js";

export const CONTRACT_MODEL_ID = "gpt-test";
export const CONTRACT_TEXT = "Hello from plugin";

const TOOL = {
  name: "search_records",
  description: "Search records",
  parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authKey(init?: RequestInit): string {
  const headers = new Headers(init?.headers);
  return (
    headers.get("x-goog-api-key") ??
    headers.get("x-api-key") ??
    headers.get("api-key") ??
    headers.get("authorization") ??
    ""
  );
}

function isGemini(init?: RequestInit): boolean {
  return new Headers(init?.headers).has("x-goog-api-key");
}

function isAnthropic(init?: RequestInit): boolean {
  return new Headers(init?.headers).has("x-api-key");
}

function isAzure(init?: RequestInit): boolean {
  const headers = new Headers(init?.headers);
  return headers.has("api-key") && !isGemini(init) && !isAnthropic(init);
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function isOllamaTags(url: string): boolean {
  return pathnameOf(url).endsWith("/api/tags");
}

function isOllamaChat(url: string): boolean {
  return pathnameOf(url).endsWith("/api/chat");
}

function isOllamaEmbed(url: string): boolean {
  return pathnameOf(url).endsWith("/api/embed");
}

function isOllamaRoot(url: string): boolean {
  return pathnameOf(url) === "/";
}

function isAzureDeploymentList(url: string, init?: RequestInit): boolean {
  if (!isAzure(init)) return false;
  if (url.includes("/chat/completions") || url.includes("/embeddings")) return false;
  return url.includes("/openai/deployments");
}

function geminiAskedForTool(raw: string): boolean {
  const body = JSON.parse(raw) as {
    contents?: Array<{ parts?: Array<{ text?: string }> }>;
  };
  const parts = body.contents?.flatMap((content) => content.parts ?? []) ?? [];
  return parts.some((part) => part.text === "TOOL");
}

function geminiChat(tool: boolean): unknown {
  const part = tool
    ? { functionCall: { name: "search_records", args: { q: "mesh" } } }
    : { text: CONTRACT_TEXT };
  return {
    candidates: [{ content: { role: "model", parts: [part] } }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
  };
}

/**
 * Mock models and chat server. OpenAI requests use `Authorization`.
 * Anthropic requests (`x-api-key`) get Messages API JSON.
 * Gemini requests (`x-goog-api-key`) get generateContent JSON.
 * Azure requests (`api-key`) list deployments and otherwise use chat-completions JSON.
 * Ollama requests (`/api/tags`, `/api/chat`, `/api/embed`, or `GET /`) use the native API.
 * Key suffixes are shared.
 */
export const contractMockFetch: ProviderFetch = async (input, init) => {
  const key = authKey(init);
  const url = String(input);
  if (key.endsWith("offline")) throw new TypeError("fetch failed");
  if (url.endsWith("/models") || isAzureDeploymentList(url, init) || isOllamaTags(url)) {
    if (key.endsWith("bad")) return jsonResponse(401, { error: { message: "invalid api key" } });
    if (isOllamaTags(url)) return jsonResponse(200, { models: [{ name: CONTRACT_MODEL_ID }] });
    if (isGemini(init)) {
      return jsonResponse(200, { models: [{ name: `models/${CONTRACT_MODEL_ID}`, displayName: "GPT Test" }] });
    }
    return jsonResponse(200, { data: [{ id: CONTRACT_MODEL_ID }] });
  }
  if (isOllamaRoot(url)) {
    if (key.endsWith("bad")) return jsonResponse(401, { error: { message: "invalid api key" } });
    return new Response("Ollama is running", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (key.endsWith("rate")) return jsonResponse(429, { error: { message: "Rate limit reached" } });
  if (key.endsWith("quota")) {
    return jsonResponse(429, { error: { message: "You exceeded your current quota" } });
  }
  if (key.endsWith("missing-model")) {
    return jsonResponse(404, { error: { message: "The model was not found" } });
  }
  const raw = typeof init?.body === "string" ? init.body : "{}";
  const body = JSON.parse(raw) as { messages?: Array<{ content?: unknown }> };
  const last = body.messages?.at(-1);
  const tool = last?.content === "TOOL";
  if (isOllamaEmbed(url)) {
    return jsonResponse(200, { embeddings: [[0.1, 0.2]] });
  }
  if (isGemini(init) && url.includes("embed")) {
    return jsonResponse(200, { embeddings: [{ values: [0.1, 0.2] }] });
  }
  if (isAzure(init) && url.includes("/embeddings")) {
    return jsonResponse(200, { data: [{ embedding: [0.1, 0.2], index: 0 }] });
  }
  if (isOllamaChat(url)) {
    const message = tool
      ? {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "search_records", arguments: { q: "mesh" } } }],
        }
      : { role: "assistant", content: CONTRACT_TEXT };
    return jsonResponse(200, {
      model: CONTRACT_MODEL_ID,
      message,
      done: true,
      prompt_eval_count: 3,
      eval_count: 4,
    });
  }
  if (isGemini(init)) return jsonResponse(200, geminiChat(geminiAskedForTool(raw)));
  if (isAnthropic(init)) {
    if (tool) {
      return jsonResponse(200, {
        content: [
          { type: "tool_use", id: "call_1", name: "search_records", input: { q: "mesh" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 3, output_tokens: 4 },
      });
    }
    return jsonResponse(200, {
      content: [{ type: "text", text: CONTRACT_TEXT }],
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 4 },
    });
  }
  if (tool) {
    return jsonResponse(200, {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "search_records", arguments: '{"q":"mesh"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    });
  }
  return jsonResponse(200, {
    choices: [{ message: { role: "assistant", content: CONTRACT_TEXT } }],
    usage: { prompt_tokens: 3, completion_tokens: 4 },
  });
};

async function collect(
  plugin: AiProviderPlugin,
  ctx: AiProviderContext,
  args: Parameters<AiProviderPlugin["streamChat"]>[1],
) {
  const events = [];
  for await (const event of plugin.streamChat(ctx, args)) events.push(event);
  return events;
}

export async function assertProviderContract(plugin: AiProviderPlugin, config: unknown): Promise<void> {
  const base = { config, fetchImpl: contractMockFetch };
  const good: AiProviderContext = { ...base, apiKey: "good" };

  const models = await plugin.listModels(good);
  assert.ok(models.some((model) => model.id === CONTRACT_MODEL_ID));

  const verified = await plugin.verifyKey(good);
  assert.equal(verified.ok, true);

  const denied = await plugin.verifyKey({ ...base, apiKey: "bad" });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, "auth");

  const textEvents = await collect(plugin, good, {
    messages: [{ role: "user", content: "Hello" }],
    tools: [],
  });
  const text = textEvents
    .filter((event) => event.type === "delta")
    .map((event) => (event.type === "delta" ? event.text : ""))
    .join("");
  assert.equal(text, CONTRACT_TEXT);
  const usage = textEvents.find((event) => event.type === "usage");
  assert.equal(usage?.type, "usage");
  if (usage?.type === "usage") {
    assert.equal(usage.usage.inputTokens, 3);
    assert.equal(usage.usage.outputTokens, 4);
  }
  assert.equal(textEvents.at(-1)?.type, "done");

  const toolEvents = await collect(plugin, good, {
    messages: [{ role: "user", content: "TOOL" }],
    tools: [TOOL],
  });
  const toolEvent = toolEvents.find((event) => event.type === "tool_calls");
  assert.equal(toolEvent?.type, "tool_calls");
  if (toolEvent?.type === "tool_calls") {
    assert.equal(toolEvent.calls[0]?.name, "search_records");
    assert.equal(toolEvent.calls[0]?.id, "call_1");
  }

  await expectCode(plugin, { ...base, apiKey: "rate" }, "rate_limit");
  await expectCode(plugin, { ...base, apiKey: "quota" }, "quota");
  await expectCode(plugin, { ...base, apiKey: "missing-model" }, "model_not_found");
  await expectCode(plugin, { ...base, apiKey: "offline" }, "network");

  if (plugin.capabilities.embeddings) {
    assert.equal(typeof plugin.embed, "function");
    const embedded = await plugin.embed!(good, ["a"]);
    assert.ok(embedded.vectors[0] && embedded.vectors[0].length > 0);
  } else {
    assert.equal(plugin.embed, undefined);
  }
}

async function expectCode(
  plugin: AiProviderPlugin,
  ctx: AiProviderContext,
  code: string,
): Promise<void> {
  await assert.rejects(
    () =>
      collect(plugin, ctx, {
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
      }),
    (err: unknown) => err instanceof AiProviderError && err.code === code,
  );
}
