import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { indexedTextChanged } from "../../knowledge/chunk.js";
import {
  autoApplyAccepts,
  planTaggingRun,
  undoFeedbackTargets,
  type NeighborCandidate,
} from "./decide.js";
import { parseModelScores } from "./parse.js";
import { tagIdsToDelete } from "../aiUndo.js";

const bug: NeighborCandidate = { tagId: 1, name: "bug", count: 3 };
const idea: NeighborCandidate = { tagId: 2, name: "idea", count: 1 };

function plan(overrides: Partial<Parameters<typeof planTaggingRun>[0]> = {}) {
  return planTaggingRun({
    contentHash: "next",
    previousHash: null,
    access: "full",
    featureOff: false,
    allowInventTags: false,
    canAutoApply: true,
    candidates: [bug, idea],
    neighborCount: 4,
    alreadyNames: [],
    modelScores: null,
    remainingSlots: 5,
    ...overrides,
  });
}

describe("auto-tag planning", () => {
  it("skips when the indexed text hash is unchanged", () => {
    assert.equal(indexedTextChanged(["a", "b"], ["b", "a"]), false);
    assert.equal(indexedTextChanged(["a"], ["a", "b"]), true);
    assert.equal(plan({ previousHash: "next" }).skip, "unchanged");
  });

  it("does not tag an excluded project or a feature the user turned off", () => {
    assert.equal(plan({ access: "excluded" }).skip, "excluded");
    assert.equal(plan({ featureOff: true }).skip, "off");
  });

  it("drops unknown names unless the user allows new tags", () => {
    const blocked = plan({
      modelScores: [
        { name: "bug", confidence: 0.9 },
        { name: "brand-new", confidence: 0.95 },
      ],
    });
    assert.deepEqual(blocked.apply.map((tag) => tag.name), ["bug"]);
    assert.equal(blocked.suggest.some((tag) => tag.name === "brand-new"), false);

    const allowed = plan({
      allowInventTags: true,
      modelScores: [{ name: "brand-new", confidence: 0.8 }],
    });
    assert.equal(allowed.apply[0]?.invented, true);
    assert.equal(allowed.apply[0]?.tagId, null);
  });

  it("shows suggestions from 0.45 and auto-applies from 0.75, never from the index alone", () => {
    const indexed = plan();
    assert.equal(indexed.apply.length, 0);
    assert.ok(indexed.suggest.some((tag) => tag.name === "bug"));

    const scored = plan({
      modelScores: [
        { name: "bug", confidence: 0.9 },
        { name: "idea", confidence: 0.5 },
        { name: "bug", confidence: 0.2 },
      ],
    });
    assert.deepEqual(scored.apply.map((tag) => tag.name), ["bug"]);
    assert.deepEqual(scored.suggest.map((tag) => tag.name), ["idea"]);
    assert.equal(autoApplyAccepts(scored), 1);

    const readOnly = plan({
      access: "read_only",
      modelScores: [{ name: "bug", confidence: 0.9 }],
    });
    assert.equal(readOnly.apply.length, 0);
    assert.equal(readOnly.suggest[0]?.name, "bug");
  });

  it("treats invalid model JSON as no scores", () => {
    assert.equal(parseModelScores("not json"), null);
    assert.deepEqual(parseModelScores('```json\n[{"name":"bug","confidence":0.8}]\n```'), [
      { name: "bug", confidence: 0.8 },
    ]);
  });

  it("undo removes only the taggings from the batch, and only unused created tags", () => {
    const created = tagIdsToDelete([8, 9], new Set([9]));
    assert.deepEqual(created, [8]);
    assert.deepEqual(undoFeedbackTargets([4, null, 4, 0]), [4]);
  });
});
