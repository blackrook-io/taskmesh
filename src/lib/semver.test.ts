import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareSemver, parseSemver } from "./semver.js";

describe("parseSemver", () => {
  it("accepts a version and a v-prefixed tag", () => {
    assert.deepEqual(parseSemver("0.47.6"), [0, 47, 6]);
    assert.deepEqual(parseSemver("v0.48.0"), [0, 48, 0]);
    assert.deepEqual(parseSemver("  V1.2.3  "), [1, 2, 3]);
  });

  it("rejects prerelease-only and non-versions", () => {
    assert.equal(parseSemver("v0.1-alpha"), null);
    assert.equal(parseSemver("latest"), null);
    assert.equal(parseSemver(""), null);
  });
});

describe("compareSemver", () => {
  it("orders newer, same, and older releases", () => {
    assert.equal(compareSemver("0.48.0", "0.47.6"), 1);
    assert.equal(compareSemver("v0.47.6", "0.47.6"), 0);
    assert.equal(compareSemver("0.47.5", "v0.47.6"), -1);
    assert.equal(compareSemver("0.48.0", "0.48.1"), -1);
  });

  it("returns null when a side is not SemVer", () => {
    assert.equal(compareSemver("v0.1-alpha", "0.47.6"), null);
  });
});
