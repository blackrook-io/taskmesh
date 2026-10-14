import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AiChatMessage, AiProviderPlugin } from "@taskmesh/ai-provider-contract";
import { redactSecrets } from "../aiMinimize.js";
import { captureMessages } from "../capture/service.js";
import { CaptureParseError, parseCaptureExtraction } from "../capture/extract.js";
import type { CaptureRecordType } from "../capture/types.js";
import { parseDuplicateAnswer } from "../duplicates/parse.js";
import { applyModelScore } from "../links/plan.js";
import { parseLinkScores } from "../links/parse.js";
import { loadPrompt } from "../promptRegistry.js";
import { planTaggingRun } from "../tagging/decide.js";
import { parseModelScores } from "../tagging/parse.js";
import { wrapUntrusted } from "../untrustedContent.js";
import type { GoldenMode } from "./run.js";

/** Must match the stub plugin. Live prompts never include this trailer. */
const STUB_REPLY_MARK = "\nSTUB_REPLY\n";

export type FeatureGoldenResult = {
  id: string;
  ok: boolean;
  detail: string;
  /** Stub-only cases expect a failed judgment. Live mode skips them. */
  expectOk: boolean;
};

type TagCase = {
  id: string;
  candidates: string[];
  excerpt: string;
  stubReply: string;
  show: string[];
};

type DupCase = {
  id: string;
  left: string;
  right: string;
  stubReply: string;
  duplicate: boolean;
};

type LinkRecord = {
  key: string;
  title: string;
  excerpt: string;
};

type LinkCase = {
  id: string;
  subject: LinkRecord;
  others: LinkRecord[];
  stubReply: string;
  judgments: Record<string, "link" | "reject">;
  stubOnly: boolean;
  expectOk: boolean;
};

type CaptureExpect = {
  recordType: CaptureRecordType | null;
  typeUnsure: boolean;
  title: string;
  priority: string | null;
  priorityUnsure: boolean;
  datePhrase: string | null;
  project: string | null;
  tags: string[];
};

type CaptureCase = {
  id: string;
  text: string;
  stubReply: string;
  expect: CaptureExpect;
};

type CaptureFile = {
  now: string;
  timeZone: string;
  cases: CaptureCase[];
};

const dir = dirname(fileURLToPath(import.meta.url));

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function asStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string list`);
  }
  return value as string[];
}

function loadTagCases(): TagCase[] {
  const parsed = loadJson("tagging.json");
  if (!Array.isArray(parsed) || parsed.length !== 8) throw new Error("Tagging golden set must have 8 cases");
  return parsed.map((row, index) => {
    const item = asRecord(row, `tagging[${index}]`);
    return {
      id: asString(item.id, `tagging[${index}].id`),
      candidates: asStringList(item.candidates, `tagging[${index}].candidates`),
      excerpt: asString(item.excerpt, `tagging[${index}].excerpt`),
      stubReply: asString(item.stubReply, `tagging[${index}].stubReply`),
      show: asStringList(item.show, `tagging[${index}].show`),
    };
  });
}

function loadDupCases(): DupCase[] {
  const parsed = loadJson("duplicates.json");
  if (!Array.isArray(parsed) || parsed.length !== 8) throw new Error("Duplicate golden set must have 8 cases");
  return parsed.map((row, index) => {
    const item = asRecord(row, `duplicates[${index}]`);
    if (typeof item.duplicate !== "boolean") throw new Error(`duplicates[${index}].duplicate must be boolean`);
    return {
      id: asString(item.id, `duplicates[${index}].id`),
      left: asString(item.left, `duplicates[${index}].left`),
      right: asString(item.right, `duplicates[${index}].right`),
      stubReply: asString(item.stubReply, `duplicates[${index}].stubReply`),
      duplicate: item.duplicate,
    };
  });
}

function loadLinkRecord(value: unknown, label: string): LinkRecord {
  const item = asRecord(value, label);
  return {
    key: asString(item.key, `${label}.key`),
    title: asString(item.title, `${label}.title`),
    excerpt: asString(item.excerpt, `${label}.excerpt`),
  };
}

function loadLinkCases(): LinkCase[] {
  const parsed = loadJson("links.json");
  if (!Array.isArray(parsed) || parsed.length !== 8) throw new Error("Link golden set must have 8 cases");
  return parsed.map((row, index) => {
    const item = asRecord(row, `links[${index}]`);
    const judgments = asRecord(item.judgments, `links[${index}].judgments`);
    const mapped: Record<string, "link" | "reject"> = {};
    for (const [key, judgment] of Object.entries(judgments)) {
      if (judgment !== "link" && judgment !== "reject") {
        throw new Error(`links[${index}].judgments.${key} must be link or reject`);
      }
      mapped[key] = judgment;
    }
    return {
      id: asString(item.id, `links[${index}].id`),
      subject: loadLinkRecord(item.subject, `links[${index}].subject`),
      others: Array.isArray(item.others)
        ? item.others.map((other, otherIndex) => loadLinkRecord(other, `links[${index}].others[${otherIndex}]`))
        : [],
      stubReply: asString(item.stubReply, `links[${index}].stubReply`),
      judgments: mapped,
      stubOnly: item.stubOnly === true,
      expectOk: item.pass !== false,
    };
  });
}

function loadCaptureFile(): CaptureFile {
  const item = asRecord(loadJson("capture.json"), "capture");
  const rows = item.cases;
  if (!Array.isArray(rows) || rows.length !== 8) throw new Error("Capture golden set must have 8 cases");
  const cases = rows.map((row, index) => {
    const raw = asRecord(row, `capture.cases[${index}]`);
    const expect = asRecord(raw.expect, `capture.cases[${index}].expect`);
    const recordType = expect.recordType;
    if (recordType !== "task" && recordType !== "todo" && recordType !== "idea" && recordType !== null) {
      throw new Error(`capture.cases[${index}].expect.recordType is invalid`);
    }
    const typedRecordType: CaptureRecordType | null = recordType;
    const priority = expect.priority;
    if (priority !== null && typeof priority !== "string") {
      throw new Error(`capture.cases[${index}].expect.priority is invalid`);
    }
    const datePhrase = expect.datePhrase;
    if (datePhrase !== null && typeof datePhrase !== "string") {
      throw new Error(`capture.cases[${index}].expect.datePhrase is invalid`);
    }
    const project = expect.project;
    if (project !== null && typeof project !== "string") {
      throw new Error(`capture.cases[${index}].expect.project is invalid`);
    }
    return {
      id: asString(raw.id, `capture.cases[${index}].id`),
      text: asString(raw.text, `capture.cases[${index}].text`),
      stubReply: asString(raw.stubReply, `capture.cases[${index}].stubReply`),
      expect: {
        recordType: typedRecordType,
        typeUnsure: expect.typeUnsure === true,
        title: typeof expect.title === "string" ? expect.title : "",
        priority,
        priorityUnsure: expect.priorityUnsure === true,
        datePhrase,
        project,
        tags: asStringList(expect.tags, `capture.cases[${index}].expect.tags`),
      },
    };
  });
  return {
    now: asString(item.now, "capture.now"),
    timeZone: asString(item.timeZone, "capture.timeZone"),
    cases,
  };
}

function withStubReply(messages: AiChatMessage[], stubReply: string, mode: GoldenMode): AiChatMessage[] {
  if (mode !== "stub") return messages;
  const copy = messages.map((message) => ({ ...message }));
  const last = copy.at(-1);
  if (!last || last.role !== "user") throw new Error("Golden case has no user message");
  last.content = `${last.content}${STUB_REPLY_MARK}${stubReply}`;
  return copy;
}

async function completeChat(args: {
  plugin: AiProviderPlugin;
  apiKey: string | null;
  config: unknown;
  assertBaseUrl: (url: string) => Promise<string>;
  messages: AiChatMessage[];
}): Promise<string> {
  let text = "";
  for await (const event of args.plugin.streamChat(
    {
      config: args.config,
      apiKey: args.apiKey,
      assertBaseUrl: args.assertBaseUrl,
    },
    { messages: args.messages, model: undefined },
  )) {
    if (event.type === "delta") text += event.text;
  }
  return text;
}

function sameNames(actual: string[], expected: string[]): boolean {
  const left = actual.map((name) => name.trim().toLowerCase()).sort();
  const right = expected.map((name) => name.trim().toLowerCase()).sort();
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function fold(value: string): string {
  return value.trim().toLowerCase();
}

function promptMessages(feature: "tagging" | "duplicates" | "links", user: string): AiChatMessage[] {
  const prompt = loadPrompt({ id: feature });
  return [
    { role: "system", content: `${prompt.body}\n\nReturn JSON only.` },
    { role: "user", content: user },
  ];
}

function scoreTagging(text: string, item: TagCase): FeatureGoldenResult {
  const scores = parseModelScores(text);
  if (!scores) return { id: item.id, ok: false, expectOk: true, detail: "invalid model json" };
  const plan = planTaggingRun({
    contentHash: "golden",
    previousHash: null,
    access: "full",
    featureOff: false,
    allowInventTags: false,
    canAutoApply: false,
    candidates: item.candidates.map((name, index) => ({ tagId: index + 1, name, count: 1 })),
    neighborCount: Math.max(item.candidates.length, 1),
    alreadyNames: [],
    modelScores: scores,
    remainingSlots: 5,
  });
  const shown = [...plan.apply, ...plan.suggest].map((tag) => tag.name);
  const ok = sameNames(shown, item.show);
  const detail = ok
    ? `show ${shown.join(", ") || "(none)"}`
    : `show ${shown.join(", ") || "(none)"}; wanted ${item.show.join(", ") || "(none)"}`;
  return { id: item.id, ok, expectOk: true, detail };
}

function scoreDuplicate(text: string, item: DupCase): FeatureGoldenResult {
  const answer = parseDuplicateAnswer(text);
  if (!answer) return { id: item.id, ok: false, expectOk: true, detail: "invalid model json" };
  const ok = answer.duplicate === item.duplicate;
  return {
    id: item.id,
    ok,
    expectOk: true,
    detail: ok ? `duplicate ${String(answer.duplicate)}` : `duplicate ${String(answer.duplicate)}; wanted ${String(item.duplicate)}`,
  };
}

function linkJudgment(match: number, reason: string): "link" | "reject" {
  const scored = applyModelScore(
    {
      entityType: "task",
      entityId: 1,
      score: 0,
      reason: "similar text",
      signal: "similar_text",
      needsModel: true,
    },
    { match, reason },
  );
  return scored.status === "rejected" ? "reject" : "link";
}

function scoreLinks(text: string, item: LinkCase): FeatureGoldenResult {
  const parsed = parseLinkScores(text);
  if (!parsed) return { id: item.id, ok: false, expectOk: item.expectOk, detail: "invalid model json" };
  const byKey = new Map(parsed.map((row) => [row.key, row]));
  const mismatches: string[] = [];
  for (const [key, judgment] of Object.entries(item.judgments)) {
    const row = byKey.get(key);
    if (!row) {
      mismatches.push(`missing ${key}`);
      continue;
    }
    const actual = linkJudgment(row.match, row.reason);
    if (actual !== judgment) mismatches.push(`${key} ${actual}`);
  }
  const ok = mismatches.length === 0;
  return {
    id: item.id,
    ok,
    expectOk: item.expectOk,
    detail: ok ? "judgments match" : mismatches.join(", "),
  };
}

function scoreCapture(text: string, item: CaptureCase): FeatureGoldenResult {
  let parsed;
  try {
    parsed = parseCaptureExtraction(text);
  } catch (err) {
    if (err instanceof CaptureParseError) {
      return { id: item.id, ok: false, expectOk: true, detail: "invalid model json" };
    }
    throw err;
  }
  const expect = item.expect;
  const mismatches: string[] = [];
  if (parsed.recordType !== expect.recordType) mismatches.push(`recordType ${parsed.recordType ?? "null"}`);
  if (parsed.typeUnsure !== expect.typeUnsure) mismatches.push(`typeUnsure ${String(parsed.typeUnsure)}`);
  if (fold(parsed.title) !== fold(expect.title)) mismatches.push(`title ${JSON.stringify(parsed.title)}`);
  if (parsed.priority !== expect.priority) mismatches.push(`priority ${parsed.priority ?? "null"}`);
  if (parsed.priorityUnsure !== expect.priorityUnsure) {
    mismatches.push(`priorityUnsure ${String(parsed.priorityUnsure)}`);
  }
  const dateOk =
    expect.datePhrase == null
      ? parsed.datePhrase == null
      : parsed.datePhrase != null && fold(parsed.datePhrase).includes(fold(expect.datePhrase));
  if (!dateOk) mismatches.push(`datePhrase ${JSON.stringify(parsed.datePhrase)}`);
  const projectOk =
    expect.project == null
      ? parsed.project == null
      : parsed.project != null && fold(parsed.project) === fold(expect.project);
  if (!projectOk) mismatches.push(`project ${JSON.stringify(parsed.project)}`);
  if (!sameNames(parsed.tags, expect.tags)) mismatches.push(`tags ${parsed.tags.join(", ") || "(none)"}`);
  const ok = mismatches.length === 0;
  return { id: item.id, ok, expectOk: true, detail: ok ? "fields match" : mismatches.join(", ") };
}

function linkBlock(record: LinkRecord): string {
  return wrapUntrusted(redactSecrets(`${record.key} ${record.title}\n${record.excerpt}`), "links");
}

export async function runFeatureGoldenCases(args: {
  plugin: AiProviderPlugin;
  apiKey: string | null;
  config: unknown;
  assertBaseUrl: (url: string) => Promise<string>;
  mode: GoldenMode;
}): Promise<FeatureGoldenResult[]> {
  const results: FeatureGoldenResult[] = [];
  const call = async (messages: AiChatMessage[], stubReply: string): Promise<string> =>
    completeChat({
      ...args,
      messages: withStubReply(messages, stubReply, args.mode),
    });

  for (const item of loadTagCases()) {
    try {
      const user = [
        "New names are not allowed.",
        `Candidates: ${item.candidates.join(", ")}`,
        wrapUntrusted(redactSecrets(item.excerpt), "tagging"),
      ].join("\n");
      const text = await call(promptMessages("tagging", user), item.stubReply);
      results.push(scoreTagging(text, item));
    } catch (err) {
      results.push({
        id: item.id,
        ok: false,
        expectOk: true,
        detail: err instanceof Error ? err.message : "Provider call failed",
      });
    }
  }

  for (const item of loadDupCases()) {
    try {
      const user = [
        wrapUntrusted(redactSecrets(item.left), "duplicates"),
        wrapUntrusted(redactSecrets(item.right), "duplicates"),
      ].join("\n");
      const text = await call(promptMessages("duplicates", user), item.stubReply);
      results.push(scoreDuplicate(text, item));
    } catch (err) {
      results.push({
        id: item.id,
        ok: false,
        expectOk: true,
        detail: err instanceof Error ? err.message : "Provider call failed",
      });
    }
  }

  for (const item of loadLinkCases()) {
    if (item.stubOnly && args.mode === "live") continue;
    try {
      const user = [linkBlock(item.subject), ...item.others.map(linkBlock)].join("\n");
      const text = await call(promptMessages("links", user), item.stubReply);
      results.push(scoreLinks(text, item));
    } catch (err) {
      results.push({
        id: item.id,
        ok: false,
        expectOk: item.expectOk,
        detail: err instanceof Error ? err.message : "Provider call failed",
      });
    }
  }

  const capture = loadCaptureFile();
  const capturePrompt = loadPrompt({ id: "capture" });
  for (const item of capture.cases) {
    try {
      const messages = captureMessages({
        prompt: capturePrompt.body,
        text: item.text,
        now: new Date(capture.now),
        timeZone: capture.timeZone,
        contextText: null,
      });
      const text = await call(messages, item.stubReply);
      results.push(scoreCapture(text, item));
    } catch (err) {
      results.push({
        id: item.id,
        ok: false,
        expectOk: true,
        detail: err instanceof Error ? err.message : "Provider call failed",
      });
    }
  }

  return results;
}
