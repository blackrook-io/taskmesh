import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_OVERVIEW_PANEL_DAYS,
  DEFAULT_OVERVIEW_PANEL_LIMIT,
  makePanelInstance,
  normalizeLayoutStored,
  seedDefaultLayout,
  validateLayoutInput,
} from "./overviewPrefs.js";

describe("overviewPrefs", () => {
  it("seeds four default panels", () => {
    const layout = seedDefaultLayout();
    assert.equal(layout.length, 4);
    assert.equal(layout[0]?.type, "recently_completed_tasks");
    assert.equal(layout[0]?.limit, DEFAULT_OVERVIEW_PANEL_LIMIT);
    assert.equal(layout[0]?.days, DEFAULT_OVERVIEW_PANEL_DAYS);
    assert.equal(layout[1]?.type, "next_tasks_due");
    assert.equal(layout[1]?.days, undefined);
  });

  it("normalizes legacy key→prefs map into instances", () => {
    const layout = normalizeLayoutStored({
      next_tasks_due: { limit: 10 },
      todos_upcoming: { limit: 20, days: 30 },
      unknown_panel: { limit: 20 },
    } as Record<string, { limit: 5 | 10 | 20; days?: number }>);
    assert.ok(layout);
    assert.equal(layout!.length, 4);
    const next = layout!.find((p) => p.type === "next_tasks_due");
    const upcoming = layout!.find((p) => p.type === "todos_upcoming");
    assert.equal(next?.limit, 10);
    assert.equal(upcoming?.limit, 20);
    assert.equal(upcoming?.days, 30);
  });

  it("validates layout and rejects bad type", () => {
    assert.throws(
      () =>
        validateLayoutInput([
          { id: "a", type: "not_a_panel", limit: 5 },
        ]),
      /Invalid overview panel/,
    );
  });

  it("accepts my_tasks_today instances", () => {
    const inst = makePanelInstance("my_tasks_today", { limit: 10 });
    const layout = validateLayoutInput([inst]);
    assert.equal(layout[0]?.type, "my_tasks_today");
    assert.equal(layout[0]?.limit, 10);
    assert.equal(layout[0]?.days, undefined);
  });
});
