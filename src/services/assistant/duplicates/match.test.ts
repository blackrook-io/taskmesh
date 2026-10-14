import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyModelAnswer,
  isDuplicateEntityType,
  normalizeTitle,
  pairKey,
  planDuplicateHits,
  type PlannedDuplicate,
  type TitleCandidate,
} from "./match.js";

function candidate(partial: Partial<TitleCandidate> & Pick<TitleCandidate, "entityType" | "entityId" | "title">): TitleCandidate {
  return { semantic: null, modelBlocked: false, ...partial };
}

describe("duplicate matching", () => {
  it("treats only tasks and todos as duplicate records", () => {
    assert.equal(isDuplicateEntityType("task"), true);
    assert.equal(isDuplicateEntityType("todo"), true);
    assert.equal(isDuplicateEntityType("document"), false);
    assert.equal(isDuplicateEntityType("idea"), false);
  });

  it("matches a task title to a todo and skips the model on an exact title", () => {
    const hits = planDuplicateHits({
      subject: { entityType: "task", entityId: 4 },
      subjectTitle: "Video course: VPC and networking",
      candidates: [
        candidate({
          entityType: "todo",
          entityId: 9,
          title: "video course, vpc and networking",
        }),
      ],
      suppressedKeys: new Set(),
      subjectBlocked: false,
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.entityType, "todo");
    assert.equal(hits[0]?.reason, "exact_title");
    assert.equal(hits[0]?.needsModel, false);
    assert.equal(hits[0]?.score, 1);
  });

  it("does not raise an ignored pair again, in either direction", () => {
    const subject = { entityType: "todo" as const, entityId: 9 };
    const match = { entityType: "task" as const, entityId: 4 };
    const hits = planDuplicateHits({
      subject,
      subjectTitle: "Buy oat milk",
      candidates: [candidate({ ...match, title: "Buy oat milk" })],
      suppressedKeys: new Set([pairKey(match, subject)]),
      subjectBlocked: false,
    });
    assert.deepEqual(hits, []);
  });

  it("does not ask a model to read excluded-project text", () => {
    const hits = planDuplicateHits({
      subject: { entityType: "task", entityId: 1 },
      subjectTitle: "Review the quarterly notes",
      candidates: [
        candidate({
          entityType: "todo",
          entityId: 2,
          title: "Review the quarterly planning notes",
          modelBlocked: true,
        }),
      ],
      suppressedKeys: new Set(),
      subjectBlocked: false,
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.needsModel, false);
    assert.equal(hits[0]?.reason, "near_title");
  });

  it("asks the model only for the best ambiguous hit", () => {
    const hits = planDuplicateHits({
      subject: { entityType: "task", entityId: 1 },
      subjectTitle: "Ship the networking guide",
      candidates: [
        candidate({
          entityType: "todo",
          entityId: 2,
          title: "Ship the networking guide draft",
          semantic: 0.8,
        }),
        candidate({
          entityType: "task",
          entityId: 3,
          title: "unrelated",
          semantic: 0.81,
        }),
      ],
      suppressedKeys: new Set(),
      subjectBlocked: false,
    });
    const asking = hits.filter((hit) => hit.needsModel);
    assert.equal(asking.length, 1);
    assert.equal(asking[0]?.entityId, 2);
  });

  it("drops a model no and keeps a deterministic hit when the model output is invalid", () => {
    const hit: PlannedDuplicate = {
      entityType: "task",
      entityId: 3,
      score: 0.84,
      reason: "near_title",
      needsModel: true,
    };
    assert.equal(applyModelAnswer(hit, { duplicate: false, confidence: 0.9 }), null);
    const kept = applyModelAnswer(hit, null);
    assert.equal(kept?.reason, "near_title");
    assert.equal(kept?.needsModel, false);
  });

  it("normalizes case and punctuation before comparing", () => {
    assert.equal(normalizeTitle("  VPC, and Networking! "), "vpc and networking");
  });
});
