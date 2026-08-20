import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBlockersMessage,
  isDependencyBlockingState,
  isOpenTaskState,
  type TaskDepSummary,
} from "../services/taskDependencies.js";

describe("taskDependencies helpers", () => {
  it("treats complete, canceled, and deleted as terminal for lists", () => {
    assert.equal(isOpenTaskState("new"), true);
    assert.equal(isOpenTaskState("ready"), true);
    assert.equal(isOpenTaskState("in_progress"), true);
    assert.equal(isOpenTaskState("pending"), true);
    assert.equal(isOpenTaskState("on_hold"), true);
    assert.equal(isOpenTaskState("complete"), false);
    assert.equal(isOpenTaskState("canceled"), false);
    assert.equal(isOpenTaskState("deleted"), false);
  });

  it("does not treat pending as a dependency blocker", () => {
    assert.equal(isDependencyBlockingState("pending"), false);
    assert.equal(isDependencyBlockingState("complete"), false);
    assert.equal(isDependencyBlockingState("in_progress"), true);
    assert.equal(isDependencyBlockingState("ready"), true);
  });

  it("formats complete/delete blocker messages", () => {
    const blockers: TaskDepSummary[] = [
      { id: 1, number: 10, title: "Setup", state: "in_progress" },
      { id: 2, number: 11, title: "Docs", state: "new" },
    ];
    assert.match(
      formatBlockersMessage("complete", blockers),
      /T0010 \(in_progress\).*T0011 \(new\)/,
    );
    assert.match(formatBlockersMessage("delete", blockers), /required by open task/);
  });
});
