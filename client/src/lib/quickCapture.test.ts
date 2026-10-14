import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyChoice,
  confirmBodyOf,
  draftFromCapture,
  isConfirmable,
  leaveQuestion,
  setRecordType,
  splitCaptureLines,
  type CaptureDraft,
  type CaptureResult,
} from "./quickCapture.ts";

function result(over: Partial<CaptureResult["proposal"]> = {}): CaptureResult {
  return {
    confirmable: true,
    denied: null,
    questions: [],
    proposal: {
      recordType: "todo",
      title: "Book the exam slot",
      description: null,
      dueDate: "2026-10-16",
      priority: "urgent",
      project: { entityType: "project", id: 4, ref: "P0004", title: "AWS", projectId: null },
      list: null,
      tags: [],
      parent: null,
      links: [],
      ...over,
    },
  };
}

describe("splitCaptureLines", () => {
  it("drops blank lines and keeps the overflow", () => {
    const text = ["one", "", " two ", ...Array.from({ length: 10 }, (_, i) => `extra ${i}`)].join("\n");
    const split = splitCaptureLines(text);
    assert.equal(split.lines.length, 10);
    assert.equal(split.lines[0], "one");
    assert.equal(split.lines[1], "two");
    assert.match(split.remainder, /^extra 8/);
  });
});

describe("capture drafts", () => {
  it("confirms a complete card and strips an idea", () => {
    const draft = draftFromCapture("ToDo: book", result(), "a");
    assert.equal(isConfirmable(draft), true);
    assert.equal(confirmBodyOf(draft)?.projectId, 4);
    const idea = setRecordType(draft, "idea");
    assert.equal(idea.project, null);
    assert.equal(idea.dueDate, "");
    assert.equal(confirmBodyOf(idea)?.projectId, null);
  });

  it("stays blocked until a question is answered", () => {
    const draft = draftFromCapture("AWS", result({ project: null }), "b");
    const asked: CaptureDraft = {
      ...draft,
      questions: [
        {
          field: "project",
          prompt: "Which project?",
          choices: [
            { ref: "P0004", title: "AWS", entityType: "project", id: 4 },
            { ref: "P0008", title: "AWS migration", entityType: "project", id: 8 },
          ],
        },
      ],
    };
    assert.equal(isConfirmable(asked), false);
    const picked = applyChoice(asked, asked.questions[0]!, asked.questions[0]!.choices![0]!);
    assert.equal(picked.project?.id, 4);
    assert.equal(isConfirmable(picked), true);
    const skipped = leaveQuestion(asked, "project");
    assert.equal(skipped.project, null);
    assert.equal(isConfirmable(skipped), true);
  });
});
