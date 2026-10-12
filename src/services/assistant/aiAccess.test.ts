import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aiAccessWiderThan,
  aiPairExcluded,
  effectiveAiAccess,
  linksVisibleToAi,
  narrowerAiAccess,
} from "./aiAccess.js";
import { aiLocalOnlyWiderThanCeiling, effectiveAiLocalOnly } from "./projectAiAccess.js";

describe("project AI access", () => {
  it("treats excluded as narrower than read-only and full", () => {
    assert.equal(narrowerAiAccess("full", "excluded"), "excluded");
    assert.equal(narrowerAiAccess("read_only", "full"), "read_only");
    assert.equal(effectiveAiAccess("full", "read_only"), "read_only");
    assert.equal(effectiveAiAccess("excluded", "full"), "excluded");
    assert.equal(aiAccessWiderThan("full", "read_only"), true);
    assert.equal(aiAccessWiderThan("read_only", "read_only"), false);
    assert.equal(aiAccessWiderThan("excluded", "read_only"), false);
  });

  it("skips a link pair when either project is excluded", () => {
    assert.equal(aiPairExcluded("full", "excluded"), true);
    assert.equal(aiPairExcluded("excluded", "read_only"), true);
    assert.equal(aiPairExcluded("full", "read_only"), false);
    const kept = linksVisibleToAi([
      { from: "full" as const, to: "read_only" as const, id: 1 },
      { from: "excluded" as const, to: "full" as const, id: 2 },
    ]);
    assert.deepEqual(kept.map((link) => link.id), [1]);
  });

  it("forces local-only from the project or the ceiling, and only narrows", () => {
    assert.equal(effectiveAiLocalOnly(false, false), false);
    assert.equal(effectiveAiLocalOnly(true, false), true);
    assert.equal(effectiveAiLocalOnly(false, true), true);
    assert.equal(effectiveAiLocalOnly(true, true), true);
    assert.equal(aiLocalOnlyWiderThanCeiling(false, true), true);
    assert.equal(aiLocalOnlyWiderThanCeiling(true, true), false);
    assert.equal(aiLocalOnlyWiderThanCeiling(false, false), false);
  });
});
