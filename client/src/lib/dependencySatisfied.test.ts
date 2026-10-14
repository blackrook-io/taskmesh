import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDependencySatisfied } from "./dependencySatisfied.ts";
import { TASK_STATES } from "./taskFields.ts";

const SATISFIED = new Set(["complete", "canceled", "deleted", "pending"]);

describe("client isDependencySatisfied", () => {
  it("classifies every task state", () => {
    for (const state of TASK_STATES) {
      assert.equal(isDependencySatisfied(state), SATISFIED.has(state), state);
    }
  });

  it("does not treat an unknown state as satisfied", () => {
    assert.equal(isDependencySatisfied(""), false);
    assert.equal(isDependencySatisfied("archived"), false);
  });
});
