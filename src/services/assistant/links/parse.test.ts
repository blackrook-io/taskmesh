import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLinkScores } from "./parse.js";

describe("parseLinkScores", () => {
  it("reads a fenced items array and skips a bad row", () => {
    const parsed = parseLinkScores(
      '```json\n{"items":[{"key":"task:12","match":0.8,"reason":"same rollout"},{"key":"nope","match":1,"reason":"x"}]}\n```',
    );
    assert.deepEqual(parsed, [{ key: "task:12", match: 0.8, reason: "same rollout" }]);
  });

  it("returns null when the model did not return items", () => {
    assert.equal(parseLinkScores("not json"), null);
    assert.equal(parseLinkScores('{"match":1}'), null);
  });
});
