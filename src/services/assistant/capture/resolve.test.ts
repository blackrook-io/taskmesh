import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { classifyChangePlan } from "../aiTiers.js";
import { loadPrompt } from "../promptRegistry.js";
import { captureMessages } from "./service.js";
import { CaptureParseError, parseCaptureExtraction } from "./extract.js";
import { captureOperations, lookupFromHits, resolveCapture } from "./resolve.js";
import type { CaptureExtraction, CaptureHit } from "./types.js";

type GoldenExpect = {
  confirmable?: boolean;
  recordType?: string | null;
  title?: string;
  dueDate?: string | null;
  priority?: string | null;
  project?: string | null;
  list?: string | null;
  parent?: string | null;
  links?: string[];
  tags?: string[];
  questionFields?: string[];
  choiceRefs?: string[];
};

type GoldenCase = {
  id: string;
  text: string;
  extraction: Partial<CaptureExtraction>;
  pageProjectId?: number;
  pageListId?: number;
  expect: GoldenExpect;
};

type GoldenFile = {
  now: string;
  timeZone: string;
  hits: CaptureHit[];
  cases: GoldenCase[];
};

const golden = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "golden.json"), "utf8"),
) as GoldenFile;

function extraction(partial: Partial<CaptureExtraction>): CaptureExtraction {
  return {
    recordType: null,
    typeUnsure: false,
    title: "",
    description: null,
    priority: null,
    priorityUnsure: false,
    datePhrase: null,
    dateUnsure: false,
    project: null,
    list: null,
    tags: [],
    parent: null,
    links: [],
    ...partial,
  };
}

function resolveCase(item: GoldenCase) {
  const hits = golden.hits;
  const pageProject = item.pageProjectId
    ? hits.find((hit) => hit.entityType === "project" && hit.id === item.pageProjectId) ?? null
    : null;
  const pageList = item.pageListId ? hits.find((hit) => hit.id === item.pageListId) ?? null : null;
  return resolveCapture({
    text: item.text,
    extraction: extraction(item.extraction),
    now: new Date(golden.now),
    timeZone: golden.timeZone,
    pageProject,
    pageList,
    lookup: lookupFromHits(hits),
    projectById: (projectId) =>
      hits.find((hit) => hit.entityType === "project" && hit.id === projectId) ?? null,
  });
}

describe("capture golden set", () => {
  it("holds fifty sentences", () => {
    assert.equal(golden.cases.length, 50);
    assert.equal(new Set(golden.cases.map((item) => item.id)).size, 50);
  });

  for (const item of golden.cases) {
    it(item.id, () => {
      const first = resolveCase(item);
      const second = resolveCase(item);
      assert.deepEqual(second, first);
      const expect = item.expect;
      if (expect.confirmable !== undefined) assert.equal(first.confirmable, expect.confirmable);
      if (expect.recordType !== undefined) assert.equal(first.proposal.recordType, expect.recordType);
      if (expect.title !== undefined) assert.equal(first.proposal.title, expect.title);
      if (expect.dueDate !== undefined) assert.equal(first.proposal.dueDate, expect.dueDate);
      if (expect.priority !== undefined) assert.equal(first.proposal.priority, expect.priority);
      if (expect.project !== undefined) assert.equal(first.proposal.project?.ref ?? null, expect.project);
      if (expect.list !== undefined) assert.equal(first.proposal.list?.ref ?? null, expect.list);
      if (expect.parent !== undefined) assert.equal(first.proposal.parent?.ref ?? null, expect.parent);
      if (expect.links) assert.deepEqual(first.proposal.links.map((link) => link.ref), expect.links);
      if (expect.tags) assert.deepEqual(first.proposal.tags, expect.tags);
      if (expect.questionFields) {
        assert.deepEqual(first.questions.map((question) => question.field), expect.questionFields);
      }
      if (expect.choiceRefs) {
        const refs = first.questions.flatMap((question) => question.choices?.map((choice) => choice.ref) ?? []);
        assert.deepEqual(refs, expect.choiceRefs);
      }
    });
  }
});

describe("capture extraction", () => {
  it("reads a fenced reply and maps priority words", () => {
    const parsed = parseCaptureExtraction(
      "```json\n{\"title\":\"book\",\"priority\":\"asap\",\"datePhrase\":\"Friday\"}\n```",
    );
    assert.equal(parsed.title, "book");
    assert.equal(parsed.priority, "urgent");
    assert.equal(parsed.datePhrase, "Friday");
    assert.equal(parsed.priorityUnsure, false);
  });

  it("turns an unknown priority into a question flag", () => {
    const parsed = parseCaptureExtraction('{"title":"file","priority":"critical"}');
    assert.equal(parsed.priority, null);
    assert.equal(parsed.priorityUnsure, true);
  });

  it("rejects a reply that is not JSON", () => {
    assert.throws(() => parseCaptureExtraction("not json"), CaptureParseError);
  });
});

describe("capture plan", () => {
  it("loads the capture prompt", () => {
    const prompt = loadPrompt({ id: "capture" });
    assert.equal(prompt.ref, "capture@1");
    assert.match(prompt.body, /datePhrase/);
  });

  it("classifies a complete todo as tier 2", () => {
    const item = golden.cases[0]!;
    const resolved = resolveCase(item);
    const plan = classifyChangePlan(captureOperations(resolved.proposal, 1));
    assert.equal(plan.tier, 2);
    assert.equal(resolved.confirmable, true);
  });

  it("raises the plan when tags push past the record limit", () => {
    const resolved = resolveCapture({
      text: "ToDo: label the boxes",
      extraction: extraction({
        recordType: "todo",
        title: "label the boxes",
        tags: ["a", "b", "c", "d", "e", "f"],
      }),
      now: new Date(golden.now),
      timeZone: golden.timeZone,
      pageProject: null,
      pageList: null,
      lookup: lookupFromHits(golden.hits),
    });
    const plan = classifyChangePlan(captureOperations(resolved.proposal, 1));
    assert.equal(plan.tier, 3);
    assert.equal(resolved.confirmable, true);
  });

  it("redacts a key in the sentence sent to the model", () => {
    const messages = captureMessages({
      prompt: "extract",
      text: "ToDo: store sk-abcdefghijklmnopqrstuvwxyz",
      now: new Date(golden.now),
      timeZone: golden.timeZone,
      contextText: null,
    });
    const user = messages.find((message) => message.role === "user");
    assert.match(user?.content ?? "", /\[redacted\]/);
    assert.doesNotMatch(user?.content ?? "", /sk-abc/);
    assert.match(messages[0]?.content ?? "", /2026-10-14/);
    assert.match(messages[0]?.content ?? "", /America\/New_York/);
  });
});
