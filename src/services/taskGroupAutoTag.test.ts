import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectAutoTagAttachments } from "./taskGroupAutoTag.js";
import { taskMatchesGroupFilter } from "../lib/taskListFilterMatch.js";

const task = {
  id: 1,
  number: 10,
  title: "Ship it",
  state: "complete",
  priority: "high",
  phaseId: null,
  projectId: 4,
};

describe("taskMatchesGroupFilter", () => {
  it("matches state is complete", () => {
    assert.equal(
      taskMatchesGroupFilter(task, {
        clauses: [{ field: "state", operator: "is", value: "complete" }],
        joins: [],
      }),
      true,
    );
    assert.equal(
      taskMatchesGroupFilter(task, {
        clauses: [{ field: "state", operator: "is", value: "new" }],
        joins: [],
      }),
      false,
    );
  });

  it("matches tags contains by id", () => {
    const ctx = {
      taskTags: new Map([[1, [{ id: 9, name: "done" }]]]),
      tagNames: new Map([[9, "done"]]),
    };
    assert.equal(
      taskMatchesGroupFilter(
        task,
        { clauses: [{ field: "tags", operator: "contains", value: "9" }], joins: [] },
        ctx,
      ),
      true,
    );
    assert.equal(
      taskMatchesGroupFilter(
        task,
        { clauses: [{ field: "tags", operator: "contains", value: "8" }], joins: [] },
        ctx,
      ),
      false,
    );
  });
});

describe("collectAutoTagAttachments", () => {
  it("applies auto-tag when the filter matches", () => {
    const out = collectAutoTagAttachments(
      [
        {
          autoTagId: 5,
          filter: { clauses: [{ field: "priority", operator: "is", value: "high" }], joins: [] },
        },
      ],
      [task],
      new Map(),
      { tagNames: new Map([[5, "hot"]]) },
    );
    assert.deepEqual(out, [{ taskId: 1, tagId: 5 }]);
  });

  it("does not duplicate an existing tagging", () => {
    const out = collectAutoTagAttachments(
      [
        {
          autoTagId: 5,
          filter: { clauses: [{ field: "priority", operator: "is", value: "high" }], joins: [] },
        },
      ],
      [task],
      new Map([[1, [{ id: 5, name: "hot" }]]]),
      { tagNames: new Map([[5, "hot"]]) },
    );
    assert.deepEqual(out, []);
  });

  it("chains: tagging from group A can satisfy group B", () => {
    const out = collectAutoTagAttachments(
      [
        {
          autoTagId: 1,
          filter: { clauses: [{ field: "state", operator: "is", value: "complete" }], joins: [] },
        },
        {
          autoTagId: 2,
          filter: { clauses: [{ field: "tags", operator: "contains", value: "1" }], joins: [] },
        },
      ],
      [task],
      new Map(),
      { tagNames: new Map([[1, "a"], [2, "b"]]) },
    );
    assert.deepEqual(out, [
      { taskId: 1, tagId: 1 },
      { taskId: 1, tagId: 2 },
    ]);
  });

  it("skips deleted tasks", () => {
    const out = collectAutoTagAttachments(
      [
        {
          autoTagId: 5,
          filter: { clauses: [{ field: "priority", operator: "is", value: "high" }], joins: [] },
        },
      ],
      [{ ...task, state: "deleted" }],
      new Map(),
      { tagNames: new Map([[5, "hot"]]) },
    );
    assert.deepEqual(out, []);
  });
});
