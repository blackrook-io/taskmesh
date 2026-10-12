import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AiChatMessage, AiProviderPlugin } from "@taskmesh/ai-provider-contract";

export type GoldenCase = {
  id: string;
  feature: string;
  messages: AiChatMessage[];
  stub: { includes: string };
  live: { minChars: number };
};

export type GoldenMode = "stub" | "live";

export type GoldenCaseResult = {
  id: string;
  ok: boolean;
  detail: string;
};

const casesPath = join(dirname(fileURLToPath(import.meta.url)), "cases.json");

export function loadGoldenCases(): GoldenCase[] {
  const parsed = JSON.parse(readFileSync(casesPath, "utf8")) as GoldenCase[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Golden set is empty");
  }
  return parsed;
}

export async function runGoldenCases(args: {
  plugin: AiProviderPlugin;
  apiKey: string;
  config: unknown;
  assertBaseUrl: (url: string) => Promise<string>;
  mode: GoldenMode;
  cases?: GoldenCase[];
}): Promise<GoldenCaseResult[]> {
  const cases = args.cases ?? loadGoldenCases();
  const results: GoldenCaseResult[] = [];
  for (const item of cases) {
    let text = "";
    try {
      for await (const event of args.plugin.streamChat(
        {
          config: args.config,
          apiKey: args.apiKey,
          assertBaseUrl: args.assertBaseUrl,
        },
        { messages: item.messages, model: undefined },
      )) {
        if (event.type === "delta") text += event.text;
      }
    } catch (err) {
      results.push({
        id: item.id,
        ok: false,
        detail: err instanceof Error ? err.message : "Provider call failed",
      });
      continue;
    }
    if (args.mode === "stub") {
      const ok = text.includes(item.stub.includes);
      results.push({
        id: item.id,
        ok,
        detail: ok ? `includes ${JSON.stringify(item.stub.includes)}` : `reply was ${JSON.stringify(text)}`,
      });
    } else {
      const ok = text.trim().length >= item.live.minChars;
      results.push({
        id: item.id,
        ok,
        detail: ok ? `reply length ${text.trim().length}` : "empty reply",
      });
    }
  }
  return results;
}
