import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyMergeFilter,
  mergeListAndGroupFilter,
  stripFilterFields,
  type MergeTaskListFilter,
} from "./mergeTaskListFilters.js";
import { taskMatchesGroupFilter } from "./taskListFilterMatch.js";

function f(
  clauses: MergeTaskListFilter["clauses"],
  joins: string[] = [],
): MergeTaskListFilter {
  return { clauses, joins };
}

function matchesMerged(
  task: {
    id: number;
    number: number;
    title: string;
    state: string;
    priority: string;
    phaseId: number | null;
    projectId: number | null;
  },
  list: MergeTaskListFilter,
  group: MergeTaskListFilter,
): boolean {
  const { listRemainder, group: g } = mergeListAndGroupFilter(list, group);
  return taskMatchesGroupFilter(task, listRemainder) && taskMatchesGroupFilter(task, g);
}

const openList: MergeTaskListFilter = f(
  [
    { field: "state", operator: "is_not", value: "complete" },
    { field: "state", operator: "is_not", value: "canceled" },
  ],
  ["and"],
);

describe("stripFilterFields", () => {
  it("drops all clauses for overridden fields and repairs joins", () => {
    const list = f(
      [
        { field: "state", operator: "is_not", value: "complete" },
        { field: "priority", operator: "is", value: "urgent" },
        { field: "title", operator: "contains", value: "x" },
      ],
      ["and", "and"],
    );
    const rem = stripFilterFields(list, new Set(["priority"]));
    assert.deepEqual(
      rem.clauses.map((c) => c.field),
      ["state", "title"],
    );
    assert.deepEqual(rem.joins, ["and"]);
  });

  it("uses the join before the right kept clause when middle is removed", () => {
    const list = f(
      [
        { field: "state", operator: "is", value: "ready" },
        { field: "priority", operator: "is", value: "high" },
        { field: "title", operator: "contains", value: "a" },
      ],
      ["or", "and"],
    );
    const rem = stripFilterFields(list, new Set(["priority"]));
    assert.deepEqual(
      rem.clauses.map((c) => c.field),
      ["state", "title"],
    );
    assert.deepEqual(rem.joins, ["and"]);
  });
});

describe("mergeListAndGroupFilter", () => {
  it("empty list → group only (remainder empty)", () => {
    const group = f([{ field: "state", operator: "is", value: "complete" }]);
    const { listRemainder, group: g } = mergeListAndGroupFilter(emptyMergeFilter(), group);
    assert.equal(listRemainder.clauses.length, 0);
    assert.equal(g.clauses.length, 1);
  });

  it("example 1: state override shows Complete in that group", () => {
    const group = f([{ field: "state", operator: "is", value: "complete" }]);
    const { listRemainder } = mergeListAndGroupFilter(openList, group);
    assert.equal(listRemainder.clauses.length, 0);

    const complete = {
      id: 1,
      number: 1,
      title: "Done",
      state: "complete",
      priority: "none",
      phaseId: null,
      projectId: 1,
    };
    const ready = {
      id: 2,
      number: 2,
      title: "Open",
      state: "ready",
      priority: "none",
      phaseId: null,
      projectId: 1,
    };
    assert.equal(matchesMerged(complete, openList, group), true);
    assert.equal(matchesMerged(ready, openList, group), false);
  });

  it("example 2: priority AND leftover state (not Complete/Canceled)", () => {
    const group = f([{ field: "priority", operator: "is", value: "urgent" }]);
    const { listRemainder } = mergeListAndGroupFilter(openList, group);
    assert.deepEqual(
      listRemainder.clauses.map((c) => c.value),
      ["complete", "canceled"],
    );

    const urgentReady = {
      id: 1,
      number: 1,
      title: "U",
      state: "ready",
      priority: "urgent",
      phaseId: null,
      projectId: 1,
    };
    const urgentComplete = {
      id: 2,
      number: 2,
      title: "U done",
      state: "complete",
      priority: "urgent",
      phaseId: null,
      projectId: 1,
    };
    const mediumReady = {
      id: 3,
      number: 3,
      title: "M",
      state: "ready",
      priority: "medium",
      phaseId: null,
      projectId: 1,
    };
    assert.equal(matchesMerged(urgentReady, openList, group), true);
    assert.equal(matchesMerged(urgentComplete, openList, group), false);
    assert.equal(matchesMerged(mediumReady, openList, group), false);
  });

  it("OR-heavy list + state override: documents strip + dual AND", () => {
    // List: state is_not complete OR priority is urgent
    // Group: state is complete
    // Remainder after strip state: priority is urgent
    // Match: (priority urgent) AND (state complete)
    const list = f(
      [
        { field: "state", operator: "is_not", value: "complete" },
        { field: "priority", operator: "is", value: "urgent" },
      ],
      ["or"],
    );
    const group = f([{ field: "state", operator: "is", value: "complete" }]);
    const { listRemainder } = mergeListAndGroupFilter(list, group);
    assert.deepEqual(listRemainder.clauses, [
      { field: "priority", operator: "is", value: "urgent" },
    ]);

    const urgentComplete = {
      id: 1,
      number: 1,
      title: "x",
      state: "complete",
      priority: "urgent",
      phaseId: null,
      projectId: 1,
    };
    const mediumComplete = {
      id: 2,
      number: 2,
      title: "y",
      state: "complete",
      priority: "medium",
      phaseId: null,
      projectId: 1,
    };
    assert.equal(matchesMerged(urgentComplete, list, group), true);
    assert.equal(matchesMerged(mediumComplete, list, group), false);
  });
});
