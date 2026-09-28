import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRejectedDerivedProgress,
  resolveDerivedParent,
  resolveParentAfterChildChange,
  rollupFromChildren,
} from "./todoHierarchy.js";

describe("rollupFromChildren", () => {
  it("counts complete children and skips canceled and deleted", () => {
    const rollup = rollupFromChildren([
      { state: "complete" },
      { state: "ready" },
      { state: "canceled" },
      { state: "deleted" },
    ]);
    assert.equal(rollup.completeCount, 1);
    assert.equal(rollup.childCount, 2);
    assert.equal(rollup.progress, 50);
    assert.equal(rollup.derived, true);
    assert.equal(rollup.allFinished, false);
  });

  it("treats only-deleted children as finished and not derived", () => {
    const rollup = rollupFromChildren([{ state: "deleted" }]);
    assert.equal(rollup.derived, false);
    assert.equal(rollup.allFinished, true);
    assert.equal(rollup.childCount, 0);
  });
});

describe("resolveDerivedParent", () => {
  const half = rollupFromChildren([{ state: "complete" }, { state: "ready" }]);

  it("stores Pending instead of Complete while a child is open", () => {
    assert.deepEqual(
      resolveDerivedParent({ state: "in_progress", progress: 50 }, half, { state: "complete" }),
      { state: "pending", progress: 50, membershipChecked: false },
    );
  });

  it("completes a parent at 100% when every child is finished", () => {
    const done = rollupFromChildren([{ state: "complete" }, { state: "canceled" }]);
    assert.deepEqual(
      resolveDerivedParent({ state: "pending", progress: 100 }, done, { state: "complete" }),
      { state: "complete", progress: 100, membershipChecked: true },
    );
  });

  it("promotes a pending parent when children finish", () => {
    const done = rollupFromChildren([{ state: "complete" }]);
    assert.deepEqual(resolveDerivedParent({ state: "pending", progress: 0 }, done), {
      state: "complete",
      progress: 100,
      membershipChecked: true,
    });
  });

  it("does not auto-complete a parent left in progress", () => {
    const done = rollupFromChildren([{ state: "complete" }]);
    assert.equal(resolveDerivedParent({ state: "in_progress", progress: 100 }, done), null);
  });

  it("reopens a complete parent when a child is open again", () => {
    assert.deepEqual(resolveDerivedParent({ state: "complete", progress: 100 }, half), {
      state: "in_progress",
      progress: 50,
      membershipChecked: false,
    });
  });

  it("rejects a manual percent on an open parent", () => {
    assert.equal(isRejectedDerivedProgress({ state: "ready", progress: 0 }, half, 40, undefined), true);
    assert.equal(isRejectedDerivedProgress({ state: "ready", progress: 0 }, half, 100, undefined), false);
    assert.equal(isRejectedDerivedProgress({ state: "complete", progress: 100 }, half, 10, undefined), false);
  });
});

describe("resolveParentAfterChildChange", () => {
  it("returns a pending parent with no children to In Progress", () => {
    const empty = rollupFromChildren([]);
    assert.deepEqual(resolveParentAfterChildChange({ state: "pending", progress: 40 }, empty), {
      state: "in_progress",
      progress: 40,
      membershipChecked: null,
    });
  });

  it("completes a pending parent whose children were all deleted", () => {
    const gone = rollupFromChildren([{ state: "deleted" }]);
    assert.deepEqual(resolveParentAfterChildChange({ state: "pending", progress: 0 }, gone), {
      state: "complete",
      progress: 100,
      membershipChecked: true,
    });
  });
});
