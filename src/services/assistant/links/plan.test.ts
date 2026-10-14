import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyModelScore,
  planLinkSuggestions,
  referencesLinkEnds,
  unorderedPairKey,
  visibleCandidates,
  type LinkCandidate,
} from "./plan.js";

function candidate(overrides: Partial<LinkCandidate> & Pick<LinkCandidate, "entityType" | "entityId">): LinkCandidate {
  return {
    sharedTags: 0,
    mention: false,
    sameList: false,
    sameBoard: false,
    semantic: null,
    modelBlocked: false,
    ...overrides,
  };
}

const subject = { entityType: "task", entityId: 1 };

describe("planLinkSuggestions", () => {
  it("drops a pair that is already linked or dismissed", () => {
    const linked = candidate({ entityType: "document", entityId: 4, mention: true });
    const open = candidate({ entityType: "idea", entityId: 8, sharedTags: 1 });
    const planned = planLinkSuggestions({
      subject,
      candidates: [linked, open],
      suppressedKeys: new Set([unorderedPairKey(subject, linked)]),
    });
    assert.deepEqual(
      planned.map((row) => row.entityId),
      [8],
    );
    assert.equal(planned[0]?.reason, "shared tags");
  });

  it("drops a candidate the user cannot see", () => {
    const hidden = candidate({ entityType: "todo", entityId: 3, sameList: true });
    const shown = candidate({ entityType: "todo", entityId: 9, sameBoard: true });
    const visible = visibleCandidates([hidden, shown], new Set(["todo:9"]));
    const planned = planLinkSuggestions({ subject, candidates: visible, suppressedKeys: new Set() });
    assert.deepEqual(
      planned.map((row) => `${row.entityType}:${row.entityId}`),
      ["todo:9"],
    );
  });

  it("ignores a weak embedding unless another signal is strong enough", () => {
    const weak = candidate({ entityType: "document", entityId: 2, semantic: 0.4 });
    const strong = candidate({ entityType: "document", entityId: 5, semantic: 0.9, modelBlocked: true });
    const planned = planLinkSuggestions({
      subject,
      candidates: [weak, strong],
      suppressedKeys: new Set(),
    });
    assert.equal(planned.length, 1);
    assert.equal(planned[0]?.entityId, 5);
    assert.equal(planned[0]?.reason, "similar text");
    assert.equal(planned[0]?.needsModel, false);
  });

  it("prefers a mention over a shared tag on the same record", () => {
    const planned = planLinkSuggestions({
      subject,
      candidates: [candidate({ entityType: "task", entityId: 6, sharedTags: 2, mention: true })],
      suppressedKeys: new Set(),
    });
    assert.equal(planned[0]?.signal, "mention");
    assert.equal(planned[0]?.reason, "mentioned by title");
  });
});

describe("applyModelScore", () => {
  const planned = {
    entityType: "idea",
    entityId: 2,
    score: 0.6,
    reason: "same list",
    signal: "same_list" as const,
    needsModel: true,
  };

  it("rejects a low model score and keeps a missing answer", () => {
    assert.equal(applyModelScore(planned, { match: 0.2, reason: "unrelated" }).status, "rejected");
    assert.equal(applyModelScore(planned, null).reason, "same list");
  });

  it("stores the model reason when the match is high enough", () => {
    const next = applyModelScore(planned, { match: 80, reason: "both cover onboarding" });
    assert.equal(next.status, "pending");
    assert.equal(next.score, 0.8);
    assert.equal(next.reason, "both cover onboarding");
  });
});

describe("referencesLinkEnds", () => {
  it("accepts as one manual references link from source to target", () => {
    assert.deepEqual(
      referencesLinkEnds({ srcType: "document", srcId: 4, dstType: "task", dstId: 1 }),
      {
        srcType: "document",
        srcId: 4,
        dstType: "task",
        dstId: 1,
        relation: "references",
      },
    );
  });
});
