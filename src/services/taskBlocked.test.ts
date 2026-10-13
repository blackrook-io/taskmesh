import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coerceReadyToBlocked, shouldPromoteBlockedDependents } from "./taskBlocked.js";

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
