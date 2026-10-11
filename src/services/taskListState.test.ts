import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTaskListStateToggle,
  EMPTY_TASK_LIST_STATE,
  normalizeIdList,
  taskListStateFromRow,
} from "./taskListState.js";

describe("normalizeIdList", () => {
  it("keeps positive integers and drops junk", () => {
    assert.deepEqual(normalizeIdList([3, 0, -1, 3, 1.5, "2", null, 8]), [3, 8]);
  });

  it("returns empty for non-arrays", () => {
    assert.deepEqual(normalizeIdList(null), []);
    assert.deepEqual(normalizeIdList({}), []);
  });
});

describe("applyTaskListStateToggle", () => {
  it("appends a collapsed group id", () => {
    const next = applyTaskListStateToggle(EMPTY_TASK_LIST_STATE, "group", 12, true);
    assert.deepEqual(next.collapsedGroupIds, [12]);
    assert.deepEqual(next.collapsedParentIds, []);
  });

  it("removes an id and leaves the other lists alone", () => {
    const start = {
      collapsedGroupIds: [4, 9],
      collapsedUngroupedProjectIds: [2],
      collapsedParentIds: [7],
    };
    const next = applyTaskListStateToggle(start, "group", 4, false);
    assert.deepEqual(next.collapsedGroupIds, [9]);
    assert.deepEqual(next.collapsedUngroupedProjectIds, [2]);
    assert.deepEqual(next.collapsedParentIds, [7]);
  });

  it("returns the same object when the toggle is a no-op", () => {
    const start = {
      collapsedGroupIds: [4],
      collapsedUngroupedProjectIds: [],
      collapsedParentIds: [],
    };
    assert.equal(applyTaskListStateToggle(start, "group", 4, true), start);
    assert.equal(applyTaskListStateToggle(start, "parent", 3, false), start);
  });

  it("tracks ungrouped projects and parents separately", () => {
    let state = EMPTY_TASK_LIST_STATE;
    state = applyTaskListStateToggle(state, "ungrouped", 4, true);
    state = applyTaskListStateToggle(state, "parent", 88, true);
    assert.deepEqual(state, {
      collapsedGroupIds: [],
      collapsedUngroupedProjectIds: [4],
      collapsedParentIds: [88],
    });
  });
});

describe("taskListStateFromRow", () => {
  it("normalizes stored arrays", () => {
    assert.deepEqual(
      taskListStateFromRow({
        collapsedGroupIds: [1, 1, -2],
        collapsedUngroupedProjectIds: "nope",
        collapsedParentIds: [5],
      }),
      {
        collapsedGroupIds: [1],
        collapsedUngroupedProjectIds: [],
        collapsedParentIds: [5],
      },
    );
  });
});
