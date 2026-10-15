import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planCandidateMatches } from "./planCandidates.js";

describe("plan candidate search", () => {
  it("matches a title, a display number, and the bare digits", () => {
    assert.equal(planCandidateMatches("task", 314, "Add items", ""), true);
    assert.equal(planCandidateMatches("task", 314, "Add items", "add"), true);
    assert.equal(planCandidateMatches("task", 314, "Add items", "T0314"), true);
    assert.equal(planCandidateMatches("task", 314, "Add items", "314"), true);
    assert.equal(planCandidateMatches("todo", 12, "Pack", "D0012"), true);
    assert.equal(planCandidateMatches("task", 314, "Add items", "missing"), false);
    assert.equal(planCandidateMatches("task", 314, "Add items", "T0315"), false);
  });
});