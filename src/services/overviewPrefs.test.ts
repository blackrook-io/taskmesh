import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_OVERVIEW_PANEL_DAYS,
  DEFAULT_OVERVIEW_PANEL_LIMIT,
  defaultOverviewPanels,
  mergeOverviewPanels,
  mergePartialOverviewPanels,
  validateOverviewPanelsInput,
} from "./overviewPrefs.js";

describe("overviewPrefs", () => {
  it("defaults all four panels", () => {
    const d = defaultOverviewPanels();
    assert.equal(d.recently_completed_tasks.limit, DEFAULT_OVERVIEW_PANEL_LIMIT);
    assert.equal(d.recently_completed_tasks.days, DEFAULT_OVERVIEW_PANEL_DAYS);
    assert.equal(d.next_tasks_due.limit, DEFAULT_OVERVIEW_PANEL_LIMIT);
    assert.equal(d.next_tasks_due.days, undefined);
    assert.equal(d.todos_overdue.days, undefined);
    assert.equal(d.todos_upcoming.days, DEFAULT_OVERVIEW_PANEL_DAYS);
  });

  it("merges stored prefs and ignores unknown keys", () => {
    const merged = mergeOverviewPanels({
      next_tasks_due: { limit: 10 },
      unknown_panel: { limit: 20 },
      todos_upcoming: { limit: 20, days: 30 },
    } as Record<string, { limit: 5 | 10 | 20; days?: number }>);
    assert.equal(merged.next_tasks_due.limit, 10);
    assert.equal(merged.todos_upcoming.limit, 20);
    assert.equal(merged.todos_upcoming.days, 30);
    assert.equal(merged.recently_completed_tasks.limit, DEFAULT_OVERVIEW_PANEL_LIMIT);
  });

  it("validates replace input and rejects bad limit", () => {
    assert.throws(
      () =>
        validateOverviewPanelsInput({
          next_tasks_due: { limit: 7 as 5 },
        }),
      /Invalid limit/,
    );
  });

  it("partial merge updates one panel", () => {
    const base = defaultOverviewPanels();
    const next = mergePartialOverviewPanels(base, {
      todos_overdue: { limit: 20 },
    });
    assert.equal(next.todos_overdue.limit, 20);
    assert.equal(next.next_tasks_due.limit, DEFAULT_OVERVIEW_PANEL_LIMIT);
  });
});
