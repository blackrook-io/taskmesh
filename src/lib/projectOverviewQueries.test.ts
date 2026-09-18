import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDaysYmd,
  localYmd,
  selectNextDue,
  selectOverdue,
  selectRecentlyCompleted,
  selectUpcoming,
  type OverviewDueRecord,
} from "./projectOverviewQueries.js";

function row(
  partial: Partial<OverviewDueRecord> & Pick<OverviewDueRecord, "id">,
): OverviewDueRecord {
  return {
    state: "ready",
    dueDate: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    sortOrder: partial.id,
    ...partial,
  };
}

describe("projectOverviewQueries", () => {
  const now = new Date(2026, 8, 18);

  it("addDaysYmd rolls calendar days", () => {
    assert.equal(addDaysYmd("2026-09-18", 5), "2026-09-23");
    assert.equal(addDaysYmd("2026-09-18", -3), "2026-09-15");
  });

  it("recently completed uses updatedAt window", () => {
    const rows = selectRecentlyCompleted(
      [
        row({ id: 1, state: "complete", updatedAt: "2026-08-01T12:00:00.000Z" }),
        row({ id: 2, state: "complete", updatedAt: "2026-09-17T12:00:00.000Z" }),
        row({ id: 3, state: "ready" }),
      ],
      5,
      14,
      now,
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      [2],
    );
  });

  it("next due includes overdue and sorts ascending", () => {
    const rows = selectNextDue(
      [
        row({ id: 1, dueDate: "2026-09-25" }),
        row({ id: 2, dueDate: "2026-09-10" }),
        row({ id: 3, state: "complete", dueDate: "2026-09-11" }),
        row({ id: 4, state: "in_progress", dueDate: "2026-09-20" }),
      ],
      5,
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      [2, 4, 1],
    );
  });

  it("overdue and upcoming use dueDate", () => {
    const todos = [
      row({ id: 1, dueDate: "2026-09-01" }),
      row({ id: 2, dueDate: localYmd(now) }),
      row({ id: 3, dueDate: addDaysYmd(localYmd(now), 3) }),
      row({ id: 4, dueDate: addDaysYmd(localYmd(now), 40) }),
      row({ id: 5, state: "complete", dueDate: "2026-09-01" }),
    ];
    assert.deepEqual(
      selectOverdue(todos, 5, now).map((t) => t.id),
      [1],
    );
    assert.deepEqual(
      selectUpcoming(todos, 5, 14, now).map((t) => t.id),
      [2, 3],
    );
  });
});
