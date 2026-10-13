import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowedTaskStates,
  nextAllowedTaskState,
  stateChangeNeedsComment,
  stateReasonPrompt,
} from "./taskFields.ts";

describe("allowed task states from the API", () => {
  it("cycles in the preference order", () => {
    assert.equal(nextAllowedTaskState(["canceled", "ready"]), "ready");
    assert.equal(nextAllowedTaskState(["canceled", "new"]), "new");
    assert.equal(nextAllowedTaskState(["complete", "on_hold"]), "on_hold");
    assert.equal(nextAllowedTaskState(["ready", "on_hold", "complete"]), "on_hold");
    assert.equal(nextAllowedTaskState([]), null);
    assert.equal(nextAllowedTaskState(undefined), null);
    assert.deepEqual(allowedTaskStates(["complete", "on_hold"]), ["on_hold", "complete"]);
  });

  it("asks for a comment when canceling or reopening", () => {
    assert.equal(stateChangeNeedsComment("ready", "canceled"), true);
    assert.equal(stateChangeNeedsComment("new", "canceled"), true);
    assert.equal(stateChangeNeedsComment("complete", "ready"), true);
    assert.equal(stateChangeNeedsComment("canceled", "ready"), true);
    assert.equal(stateChangeNeedsComment("in_progress", "ready"), true);
    assert.equal(stateChangeNeedsComment("in_progress", "complete"), false);
    assert.equal(stateChangeNeedsComment("on_hold", "in_progress"), false);
  });

  it("uses return-to-Ready copy when In Progress goes back to Ready", () => {
    assert.equal(stateReasonPrompt("in_progress", "ready").title, "Return to Ready");
    assert.equal(stateReasonPrompt("in_progress", "ready").confirmLabel, "Return to Ready");
    assert.match(stateReasonPrompt("in_progress", "ready").message, /why this work is stopping/);
    assert.equal(stateReasonPrompt("ready", "canceled").title, "Cancel task");
    assert.equal(stateReasonPrompt("complete", "ready").title, "Reopen task");
  });
});
