import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowedTaskStates,
  nextAllowedTaskState,
  stateChangeNeedsComment,
} from "./taskFields.ts";

describe("allowed task states from the API", () => {
  it("cycles in the preference order", () => {
    assert.equal(nextAllowedTaskState(["canceled", "ready"]), "ready");
    assert.equal(nextAllowedTaskState(["canceled", "new"]), "new");
    assert.equal(nextAllowedTaskState(["complete", "on_hold"]), "on_hold");
    assert.equal(nextAllowedTaskState([]), null);
    assert.equal(nextAllowedTaskState(undefined), null);
    assert.deepEqual(allowedTaskStates(["complete", "on_hold"]), ["on_hold", "complete"]);
  });

  it("asks for a comment when canceling or reopening", () => {
    assert.equal(stateChangeNeedsComment("ready", "canceled"), true);
    assert.equal(stateChangeNeedsComment("new", "canceled"), true);
    assert.equal(stateChangeNeedsComment("complete", "ready"), true);
    assert.equal(stateChangeNeedsComment("canceled", "ready"), true);
    assert.equal(stateChangeNeedsComment("in_progress", "complete"), false);
    assert.equal(stateChangeNeedsComment("on_hold", "in_progress"), false);
  });
});
