import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPromotePendingParent,
  coerceCompleteIfUnfinishedChildren,
} from "./taskPending.js";

describe("taskPending helpers", () => {
  it("coerces complete to pending when unfinished children exist", () => {
    assert.equal(coerceCompleteIfUnfinishedChildren("complete", true), "pending");
    assert.equal(coerceCompleteIfUnfinishedChildren("complete", false), "complete");
    assert.equal(coerceCompleteIfUnfinishedChildren("pending", true), "pending");
    assert.equal(coerceCompleteIfUnfinishedChildren("in_progress", true), "in_progress");
  });

  it("promotes a pending parent only when every direct child is finished", () => {
    assert.equal(canPromotePendingParent("pending", ["complete"]), true);
    assert.equal(canPromotePendingParent("pending", ["complete", "canceled", "deleted"]), true);
    assert.equal(canPromotePendingParent("pending", ["complete", "pending"]), false);
    assert.equal(canPromotePendingParent("pending", ["ready"]), false);
    assert.equal(canPromotePendingParent("in_progress", ["complete"]), false);
    assert.equal(canPromotePendingParent("pending", []), true);
  });
});
