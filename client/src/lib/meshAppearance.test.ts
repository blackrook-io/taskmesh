import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contrastBelowMinimum, contrastRatio } from "./meshAppearance";

describe("mesh contrast", () => {
  it("warns when a color is below 3:1 against the background", () => {
    assert.equal(contrastBelowMinimum("#2a2b32", "#1e1f24"), true);
    assert.equal(contrastBelowMinimum("#1e1f24", "#1e1f24"), true);
  });

  it("stays quiet at or above 3:1 and for a color that is not hex", () => {
    assert.equal(contrastBelowMinimum("#ffffff", "#1e1f24"), false);
    assert.ok((contrastRatio("#ffffff", "#000000") ?? 0) >= 3);
    assert.equal(contrastBelowMinimum("red", "#1e1f24"), false);
    assert.equal(contrastRatio("#fff", "#000000"), null);
  });
});
