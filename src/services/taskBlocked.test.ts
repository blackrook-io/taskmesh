import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coerceReadyToBlocked,
  readyTaskShouldBlock,
  shouldBlockReadyDependents,
  shouldPromoteBlockedDependents,
} from "./taskBlocked.js";

describe("blocked task state", () => {
  it("stores Draft → Ready as Blocked when a dependency is still open", () => {
    assert.equal(coerceReadyToBlocked("new", "ready", true), "blocked");
    assert.equal(coerceReadyToBlocked("new", "ready", false), "ready");
    assert.equal(coerceReadyToBlocked("blocked", "ready", true), "ready");
    assert.equal(coerceReadyToBlocked("complete", "ready", true), "ready");
    assert.equal(coerceReadyToBlocked("new", "canceled", true), "canceled");
  });

  it("stores In Progress → Ready as Blocked when a dependency is still open", () => {
    assert.equal(coerceReadyToBlocked("in_progress", "ready", true), "blocked");
    assert.equal(coerceReadyToBlocked("in_progress", "ready", false), "ready");
    assert.equal(coerceReadyToBlocked("in_progress", "on_hold", true), "on_hold");
  });

  it("blocks a Ready task that is not derived and still has an open prerequisite", () => {
    assert.equal(
      readyTaskShouldBlock({
        state: "ready",
        stateManual: false,
        rollupTotal: null,
        hasOpenDependsOn: true,
      }),
      true,
    );
    assert.equal(
      readyTaskShouldBlock({
        state: "ready",
        stateManual: true,
        rollupTotal: 2,
        hasOpenDependsOn: true,
      }),
      true,
    );
  });

  it("leaves Ready when every prerequisite is satisfied", () => {
    assert.equal(
      readyTaskShouldBlock({
        state: "ready",
        stateManual: false,
        rollupTotal: null,
        hasOpenDependsOn: false,
      }),
      false,
    );
  });

  it("does not block In Progress when a prerequisite is open", () => {
    assert.equal(
      readyTaskShouldBlock({
        state: "in_progress",
        stateManual: false,
        rollupTotal: null,
        hasOpenDependsOn: true,
      }),
      false,
    );
  });

  it("does not override a derived parent", () => {
    assert.equal(
      readyTaskShouldBlock({
        state: "ready",
        stateManual: false,
        rollupTotal: 2,
        hasOpenDependsOn: true,
      }),
      false,
    );
  });

  it("re-blocks dependents when a satisfied prerequisite becomes open", () => {
    assert.equal(shouldBlockReadyDependents("complete", "ready"), true);
    assert.equal(shouldBlockReadyDependents("canceled", "in_progress"), true);
    assert.equal(shouldBlockReadyDependents("pending", "in_progress"), true);
    assert.equal(shouldBlockReadyDependents("deleted", "new"), true);
    assert.equal(shouldBlockReadyDependents("complete", "pending"), false);
    assert.equal(shouldBlockReadyDependents("ready", "in_progress"), false);
    assert.equal(shouldBlockReadyDependents("complete", "complete"), false);
  });

  it("promotes dependents only when a blocking state becomes satisfied", () => {
    assert.equal(shouldPromoteBlockedDependents("in_progress", "complete"), true);
    assert.equal(shouldPromoteBlockedDependents("in_progress", "pending"), true);
    assert.equal(shouldPromoteBlockedDependents("ready", "canceled"), true);
    assert.equal(shouldPromoteBlockedDependents("on_hold", "deleted"), true);
    assert.equal(shouldPromoteBlockedDependents("pending", "complete"), false);
    assert.equal(shouldPromoteBlockedDependents("blocked", "ready"), false);
    assert.equal(shouldPromoteBlockedDependents("new", "blocked"), false);
    assert.equal(shouldPromoteBlockedDependents("complete", "complete"), false);
  });
});
