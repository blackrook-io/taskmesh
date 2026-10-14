import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDigestSections, type DigestItem } from "./digest.js";
import { applyDigestHides, applyDigestPrefsPatch, hideApplies, snoozeUntil, type DigestHide } from "./digestHides.js";
import { parseDigestPrefs } from "./digest.js";

const now = new Date("2026-10-14T15:00:00.000Z");

function item(id: number): DigestItem {
  return {
    entityType: "task",
    entityId: id,
    referenceId: `T${String(id).padStart(4, "0")}`,
    title: `Task ${id}`,
    projectId: 1,
    alsoProjectId: null,
    reason: "Due 1 day ago",
    href: `/tasks?open=${id}`,
  };
}

describe("digest hides", () => {
  it("hides a dismiss for this period and shows it again next period", () => {
    const hide: DigestHide = {
      entityType: "task",
      entityId: 1,
      section: "overdue",
      kind: "dismiss",
      periodKey: "2026-10-14",
      until: null,
    };
    assert.equal(hideApplies(hide, "2026-10-14", now), true);
    assert.equal(hideApplies(hide, "2026-10-15", now), false);
    const sections = emptyDigestSections();
    sections.overdue = [item(1), item(2)];
    const hidden = applyDigestHides({ sections, hides: [hide], periodKey: "2026-10-14", now });
    assert.deepEqual(hidden.sections.overdue.map((row) => row.entityId), [2]);
    assert.equal(hidden.hidden.overdue, 1);
    const next = applyDigestHides({ sections, hides: [hide], periodKey: "2026-10-15", now });
    assert.equal(next.sections.overdue.length, 2);
  });

  it("hides a snooze until the instant, then shows the item", () => {
    const hide: DigestHide = {
      entityType: "task",
      entityId: 4,
      section: "blocked",
      kind: "snooze",
      periodKey: null,
      until: "2026-10-20T00:00:00.000Z",
    };
    assert.equal(hideApplies(hide, "2026-10-14", now), true);
    assert.equal(hideApplies(hide, "2026-10-21", new Date("2026-10-20T00:00:00.000Z")), false);
    const until = snoozeUntil("tomorrow", now, "UTC");
    assert.equal(until.toISOString(), "2026-10-15T00:00:00.000Z");
    assert.equal(snoozeUntil("week", now, "UTC").toISOString(), "2026-10-21T00:00:00.000Z");
  });
});

describe("digest prefs patch", () => {
  it("keeps the hour and rejects an unknown section", () => {
    const current = parseDigestPrefs({ hour: 7, timeZone: "UTC" });
    const saved = applyDigestPrefsPatch(current, {
      frequency: "weekly",
      summary: false,
      sections: { overdue: false },
      timeZone: "America/New_York",
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.prefs.frequency, "weekly");
    assert.equal(saved.prefs.summary, false);
    assert.equal(saved.prefs.sections.overdue, false);
    assert.equal(saved.prefs.sections.blocked, true);
    assert.equal(saved.prefs.hour, 7);
    assert.equal(saved.prefs.timeZone, "America/New_York");
    const bad = applyDigestPrefsPatch(current, { sections: { nope: true } });
    assert.equal(bad.ok, false);
  });
});
