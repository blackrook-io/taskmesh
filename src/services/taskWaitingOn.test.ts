import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskDepSummary } from "./taskDependencies.js";
import { selectWaitingOnTasks } from "./taskWaitingOn.js";

const sample: TaskDepSummary[] = [
  { id: 1, number: 10, title: "Open", state: "ready" },
  { id: 2, number: 11, title: "Pending dep", state: "pending" },
  { id: 3, number: 12, title: "Done", state: "complete" },
  { id: 4, number: 13, title: "Canceled", state: "canceled" },
  { id: 5, number: 14, title: "Deleted", state: "deleted" },
  { id: 6, number: 15, title: "Child", state: "in_progress" },
];

describe("selectWaitingOnTasks", () => {
  it("lists open Depends-on for Blocked", () => {
    const result = selectWaitingOnTasks("blocked", sample, []);
    assert.equal(result.kind, "blocked");
    assert.deepEqual(
      result.tasks.map((task) => task.number),
      [10, 15],
    );
  });

  it("lists unfinished direct children for Pending", () => {
    const result = selectWaitingOnTasks("pending", [], sample);
    assert.equal(result.kind, "pending");
    assert.deepEqual(
      result.tasks.map((task) => task.number),
      [10, 11, 15],
    );
  });

  it("returns nothing for other states", () => {
    const result = selectWaitingOnTasks("ready", sample, sample);
    assert.equal(result.kind, null);
    assert.deepEqual(result.tasks, []);
  });
});
