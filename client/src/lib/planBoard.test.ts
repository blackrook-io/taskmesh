import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planBlockerLabel,
  planCheckAction,
  planDependencyGutter,
  planCheckboxChecked,
  planHoursSummary,
  planIndentDepth,
  planPhaseAccent,
  planProgressPercent,
  planRowHours,
  planUnestimatedLabel,
  readCollapsedPhaseIds,
  type PlanBoardItem,
  type PlanItemActions,
} from "./planBoard.ts";

function flags(partial: Partial<PlanItemActions> = {}): PlanItemActions {
  return {
    canCheck: false,
    canStart: false,
    canStartAndComplete: false,
    canUncheck: false,
    blockedBy: [],
    ...partial,
  };
}

function item(partial: Partial<PlanBoardItem> & Pick<PlanBoardItem, "entityId">): PlanBoardItem {
  return {
    id: partial.entityId,
    entityType: "task",
    number: partial.entityId,
    title: "Item",
    state: "ready",
    estimateHours: null,
    progress: null,
    dueDate: null,
    startDate: null,
    parentId: null,
    assignee: null,
    sortOrder: 0,
    actions: flags(),
    externalBlockers: [],
    ...partial,
  };
}

describe("plan board rows", () => {
  const parent = item({ entityId: 1, estimateHours: 8, state: "pending" });
  const child = item({ entityId: 2, parentId: 1, estimateHours: 1.5, state: "in_progress" });
  const grandchild = item({ entityId: 3, parentId: 2, estimateHours: 2, state: "ready" });
  const canceled = item({ entityId: 4, parentId: 1, estimateHours: 9, state: "canceled" });
  const orphan = item({ entityId: 5, parentId: 99, estimateHours: 4 });
  const rows = [parent, child, grandchild, canceled, orphan];

  it("indents in-plan descendants and leaves outside parents flat", () => {
    assert.equal(planIndentDepth(rows, parent), 0);
    assert.equal(planIndentDepth(rows, child), 1);
    assert.equal(planIndentDepth(rows, grandchild), 2);
    assert.equal(planIndentDepth(rows, orphan), 0);
  });

  it("shows descendant leaf hours on a parent and its own hours on a leaf", () => {
    assert.deepEqual(planRowHours(rows, parent), { hours: 2, editable: false });
    assert.deepEqual(planRowHours(rows, child), { hours: 2, editable: false });
    assert.deepEqual(planRowHours(rows, grandchild), { hours: 2, editable: true });
    assert.deepEqual(planRowHours([parent], parent), { hours: 8, editable: true });
    const sibling = item({ entityId: 6, parentId: 1, estimateHours: 1.25, state: "ready" });
    assert.deepEqual(planRowHours([parent, child, sibling], parent), { hours: 2.75, editable: false });
  });

  it("treats an all-unestimated parent summary as a blank total", () => {
    const summary = item({ entityId: 1, estimateHours: 5 });
    const open = item({ entityId: 2, parentId: 1, estimateHours: null, state: "ready" });
    assert.deepEqual(planRowHours([summary, open], summary), { hours: null, editable: false });
  });

  it("offers only the actions the flags allow", () => {
    assert.deepEqual(
      planCheckAction(item({ entityId: 1, actions: flags({ canStart: true, canStartAndComplete: true }) })),
      { kind: "ready-menu", startAndComplete: true, blockers: [] },
    );
    const blocker = { id: 9, number: 102, title: "Prep", state: "ready" };
    assert.deepEqual(
      planCheckAction(
        item({
          entityId: 1,
          state: "ready",
          actions: flags({ canStart: true, blockedBy: [blocker] }),
        }),
      ),
      { kind: "ready-menu", startAndComplete: false, blockers: [blocker] },
    );
    assert.equal(planCheckAction(item({ entityId: 1, actions: flags({ canCheck: true }) })).kind, "complete");
    assert.deepEqual(
      planCheckAction(item({ entityId: 1, entityType: "todo", actions: flags({ canUncheck: true }) })),
      { kind: "uncheck", to: "in_progress", needsComment: false },
    );
    assert.deepEqual(
      planCheckAction(item({ entityId: 1, actions: flags({ canUncheck: true }) })),
      { kind: "uncheck", to: "ready", needsComment: true },
    );
    assert.equal(planCheckAction(item({ entityId: 1 })).kind, "disabled");
    assert.equal(
      planCheckAction(item({ entityId: 1, actions: flags({ canStart: true, canCheck: true }) })).kind,
      "ready-menu",
    );
  });

  it("checks complete, pending, and a canceled row that can reopen", () => {
    assert.equal(planCheckboxChecked(item({ entityId: 1, state: "complete" })), true);
    assert.equal(planCheckboxChecked(item({ entityId: 1, state: "pending" })), true);
    assert.equal(
      planCheckboxChecked(item({ entityId: 1, state: "canceled", actions: flags({ canUncheck: true }) })),
      true,
    );
    assert.equal(planCheckboxChecked(item({ entityId: 1, state: "ready" })), false);
  });

  it("names blockers by task reference", () => {
    assert.equal(planBlockerLabel([]), null);
    assert.equal(
      planBlockerLabel([{ id: 1, number: 102, title: "Prep", state: "ready" }]),
      "Blocked by T0102",
    );
  });
});

describe("plan board header", () => {
  it("formats hours, progress, and the unestimated warning", () => {
    assert.equal(planHoursSummary(1.5, 8), "1.5 of 8 h");
    assert.equal(planProgressPercent(0.333), 33);
    assert.equal(planUnestimatedLabel(0), null);
    assert.equal(planUnestimatedLabel(1), "1 item unestimated");
    assert.equal(planUnestimatedLabel(4), "4 items unestimated");
  });

  it("keeps a hex phase color and drops anything else", () => {
    assert.equal(planPhaseAccent("#3dbe9a"), "#3dbe9a");
    assert.equal(planPhaseAccent("red"), null);
    assert.equal(planPhaseAccent(null), null);
  });

  it("names in-plan prerequisites and skips todos", () => {
    const items = [
      item({ entityId: 1, number: 10 }),
      item({ entityId: 2, number: 20 }),
      item({ entityId: 3, entityType: "todo", number: 3 }),
    ];
    const edges = [
      {
        prerequisite: { entityType: "task" as const, entityId: 1 },
        dependent: { entityType: "task" as const, entityId: 2 },
      },
      {
        prerequisite: { entityType: "task" as const, entityId: 9 },
        dependent: { entityType: "task" as const, entityId: 2 },
      },
    ];
    const dependent = items[1];
    const todo = items[2];
    assert.ok(dependent && todo);
    assert.equal(planDependencyGutter(dependent, items, edges), "← T0010");
    assert.equal(planDependencyGutter(todo, items, edges), "");
  });

  it("reads collapsed phase ids", () => {
    assert.deepEqual(readCollapsedPhaseIds(null), []);
    assert.deepEqual(readCollapsedPhaseIds("[2,4]"), [2, 4]);
    assert.deepEqual(readCollapsedPhaseIds("nope"), []);
    assert.deepEqual(readCollapsedPhaseIds("[0,\"x\",3]"), [3]);
  });
});
