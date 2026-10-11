import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dependsBlocking,
  glyphStyle,
  hiddenOverdueCounts,
  isStale,
  schedule,
  stateAppearance,
} from "./meshSignals.ts";

const today = new Date("2026-10-11T12:00:00");

describe("mesh signals", () => {
  it("draws In Progress and Complete hollow and the matching hues filled", () => {
    assert.equal(stateAppearance("new").hollow, false);
    assert.equal(stateAppearance("in_progress").hollow, true);
    assert.equal(stateAppearance("ready").hollow, false);
    assert.equal(stateAppearance("complete").hollow, true);
    assert.equal(stateAppearance("in_progress").color, "var(--task-state-progress)");
    assert.equal(glyphStyle("type", { key: "task:1", type: "task" }).color, "var(--mesh-type-task)");
    assert.equal(glyphStyle("priority", { key: "task:1", priority: "none" }).hollow, true);
    assert.equal(glyphStyle("priority", { key: "task:1", priority: "high" }).color, "var(--task-priority-high)");
  });

  it("marks a past due date overdue and a slow progress share at risk", () => {
    assert.equal(
      schedule({ key: "task:1", state: "ready", dueDate: "2026-10-01" }, today).kind,
      "overdue",
    );
    assert.equal(
      schedule({ key: "task:1", state: "complete", dueDate: "2026-10-01" }, today).kind,
      "none",
    );
    assert.equal(
      schedule(
        {
          key: "todo:1",
          state: "in_progress",
          dueDate: "2026-10-20",
          createdAt: "2026-09-01T12:00:00.000Z",
          progress: 10,
        },
        today,
      ).kind,
      "risk",
    );
    assert.equal(
      schedule(
        {
          key: "todo:1",
          state: "in_progress",
          dueDate: "2026-12-01",
          createdAt: "2026-10-01T12:00:00.000Z",
          progress: 80,
        },
        today,
      ).kind,
      "ok",
    );
  });

  it("treats a state change older than the threshold as stale", () => {
    assert.equal(
      isStale({ key: "task:1", state: "ready", signalAt: "2026-08-01T12:00:00.000Z" }, today, 30),
      true,
    );
    assert.equal(
      isStale({ key: "task:1", state: "complete", signalAt: "2026-08-01T12:00:00.000Z" }, today, 30),
      false,
    );
    assert.equal(
      isStale({ key: "task:1", state: "ready", signalAt: "2026-10-01T12:00:00.000Z" }, today, 30),
      false,
    );
  });

  it("counts unplaced overdue descendants on each placed ancestor", () => {
    const nodes = [
      { key: "project:1", state: "in_progress" },
      { key: "task:1", state: "ready" },
      { key: "task:9", state: "ready", dueDate: "2026-09-01" },
    ];
    const edges = [
      { source: "project:1", target: "task:1", relation: "in_project" },
      { source: "task:9", target: "task:1", relation: "child_of" },
    ];
    const counts = hiddenOverdueCounts(nodes, edges, new Set(["project:1", "task:1"]), today);
    assert.equal(counts.get("task:1"), 1);
    assert.equal(counts.get("project:1"), 1);
    assert.equal(dependsBlocking("ready"), true);
    assert.equal(dependsBlocking("complete"), false);
  });
});
