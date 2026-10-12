import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IDEA_LIST_FILTER_COMBINATIONS,
  TASK_LIST_FILTER_COMBINATIONS,
  TODO_LIST_FILTER_COMBINATIONS,
  isAllowedFilterCombination,
} from "./listFilterCombinations.js";
import { parseTaskGroupFilter } from "./taskGroupFilter.js";

describe("list filter combinations", () => {
  it("allows the pairs each list view dropdown offers", () => {
    assert.equal(isAllowedFilterCombination(TASK_LIST_FILTER_COMBINATIONS, "tags", "contains"), true);
    assert.equal(isAllowedFilterCombination(TASK_LIST_FILTER_COMBINATIONS, "dueDate", "before"), true);
    assert.equal(isAllowedFilterCombination(IDEA_LIST_FILTER_COMBINATIONS, "assignee", "is_empty"), true);
    assert.equal(isAllowedFilterCombination(TODO_LIST_FILTER_COMBINATIONS, "checked", "is"), true);
  });

  it("rejects pairs the dropdowns omit", () => {
    assert.equal(isAllowedFilterCombination(TASK_LIST_FILTER_COMBINATIONS, "tags", "is"), false);
    assert.equal(isAllowedFilterCombination(TASK_LIST_FILTER_COMBINATIONS, "tags", "before"), false);
    assert.equal(isAllowedFilterCombination(TASK_LIST_FILTER_COMBINATIONS, "dueDate", "contains"), false);
    assert.equal(isAllowedFilterCombination(IDEA_LIST_FILTER_COMBINATIONS, "assignee", "contains"), false);
    assert.equal(isAllowedFilterCombination(TODO_LIST_FILTER_COMBINATIONS, "checked", "contains"), false);
    assert.equal(isAllowedFilterCombination(TASK_LIST_FILTER_COMBINATIONS, "nope", "is"), false);
  });
});

describe("parseTaskGroupFilter", () => {
  it("accepts an allowed pair and an empty clause list", () => {
    assert.deepEqual(
      parseTaskGroupFilter({
        clauses: [{ field: "tags", operator: "contains", value: "32" }],
        joins: [],
      }),
      { clauses: [{ field: "tags", operator: "contains", value: "32" }], joins: [] },
    );
    assert.equal(parseTaskGroupFilter({ clauses: [], joins: [] }), null);
  });

  it("rejects a disallowed pair, an unknown field, and an unknown operator", () => {
    const tagsIs = { clauses: [{ field: "tags", operator: "is", value: "32" }], joins: [] };
    const dueContains = {
      clauses: [{ field: "dueDate", operator: "contains", value: "2026-10-11" }],
      joins: [],
    };
    assert.equal(parseTaskGroupFilter(tagsIs), "invalid");
    assert.equal(parseTaskGroupFilter(dueContains), "invalid");
    assert.equal(
      parseTaskGroupFilter({
        clauses: [{ field: "nope", operator: "is", value: "x" }],
        joins: [],
      }),
      "invalid",
    );
    assert.equal(
      parseTaskGroupFilter({
        clauses: [{ field: "state", operator: "nope", value: "new" }],
        joins: [],
      }),
      "invalid",
    );
  });
});
