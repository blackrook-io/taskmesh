import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { AiProviderPlugin } from "@taskmesh/ai-provider-contract";
import { plugin } from "@taskmesh/ai-provider-stub";
import { runFeatureGoldenCases } from "./features.js";

const stub = plugin as AiProviderPlugin;

const ctx = {
  apiKey: "test",
  config: { baseUrl: "https://stub.example.com", defaultModel: "stub" },
  assertBaseUrl: async (url: string) => url,
};

async function reply(content: string): Promise<string> {
  let text = "";
  for await (const event of stub.streamChat(ctx, {
    messages: [{ role: "user", content }],
    model: undefined,
  })) {
    if (event.type === "delta") text += event.text;
  }
  return text;
}

function fixtureReply(content: string): string {
  const root = dirname(fileURLToPath(import.meta.url));
  const read = (name: string) => JSON.parse(readFileSync(join(root, name), "utf8")) as unknown;
  const tagging = read("tagging.json") as Array<{ excerpt: string; stubReply: string }>;
  const tag = tagging.filter((item) => content.includes(item.excerpt)).sort((a, b) => b.excerpt.length - a.excerpt.length)[0];
  if (tag) return tag.stubReply;
  const duplicates = read("duplicates.json") as Array<{ left: string; right: string; stubReply: string }>;
  const dup = duplicates.filter((item) => content.includes(item.left) && content.includes(item.right));
  if (dup.length === 1) return dup[0]!.stubReply;
  const links = read("links.json") as Array<{
    stubOnly?: boolean;
    subject: { key: string };
    others: Array<{ key: string }>;
    stubReply: string;
  }>;
  const keys = new Set(content.match(/[a-z_]+:[1-9][0-9]*/g) ?? []);
  const link = links.filter((item) => {
    if (item.stubOnly) return false;
    const wanted = [item.subject.key, ...item.others.map((other) => other.key)];
    return wanted.length === keys.size && wanted.every((key) => keys.has(key));
  });
  if (link.length === 1) return link[0]!.stubReply;
  const capture = read("capture.json") as { cases: Array<{ text: string; stubReply: string }> };
  const sentence = capture.cases
    .filter((item) => content.includes(item.text))
    .sort((a, b) => b.text.length - a.text.length)[0];
  if (sentence) return sentence.stubReply;
  throw new Error("No golden fixture matched the live prompt");
}

const livePlugin: AiProviderPlugin = {
  ...stub,
  async *streamChat(_ctx, args) {
    const last = args.messages.at(-1);
    const content = last && last.role === "user" ? last.content : "";
    if (content.includes("STUB_REPLY")) throw new Error("live prompt included the stub trailer");
    yield { type: "delta", text: fixtureReply(content) };
    yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
    yield { type: "done" };
  },
};

describe("feature golden sets", () => {
  it("keeps the default stub reply unless the golden trailer is present", async () => {
    assert.equal(await reply("Hello"), "Hello from plugin");
    assert.equal(await reply("Score this\nSTUB_REPLY\n{\"duplicate\":false}"), "{\"duplicate\":false}");
  });

  it("matches tagging, duplicates, links, and capture judgments on the stub", async () => {
    const results = await runFeatureGoldenCases({
      plugin: stub,
      apiKey: "test",
      config: ctx.config,
      assertBaseUrl: ctx.assertBaseUrl,
      mode: "stub",
    });
    assert.equal(results.length, 32);
    for (const result of results) {
      assert.equal(result.ok, result.expectOk, `${result.id}: ${result.detail}`);
    }
    assert.equal(results.filter((result) => result.id.startsWith("tag-")).length, 8);
    assert.equal(results.filter((result) => result.id.startsWith("dup-")).length, 8);
    assert.equal(results.filter((result) => result.id.startsWith("link-")).length, 8);
    assert.equal(results.filter((result) => /^\d/.test(result.id)).length, 8);
  });

  it("scores the same judgments in live mode without the stub trailer", async () => {
    const results = await runFeatureGoldenCases({
      plugin: livePlugin,
      apiKey: "test",
      config: ctx.config,
      assertBaseUrl: ctx.assertBaseUrl,
      mode: "live",
    });
    assert.equal(results.length, 30);
    for (const result of results) {
      assert.equal(result.expectOk, true);
      assert.equal(result.ok, true, `${result.id}: ${result.detail}`);
    }
  });
});
