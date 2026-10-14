import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DIGEST_SECTIONS, changeWindowStart, parseDigestPrefs, shouldSummarize, summaryFactLines, withheldProjects } from "./digest.js";
import { classifyDigest, type DigestSubject } from "./digestClassify.js";
import { digestPeriod, digestSchedule, digestStale, isoWeek } from "./digestSignals.js";

const now = new Date("2026-10-14T15:00:00.000Z");
const enabled = parseDigestPrefs({}).sections;

function subject(patch: Partial<DigestSubject> & Pick<DigestSubject, "entityId" | "title">): DigestSubject {
  return {
    entityType: "task",
    referenceId: `T${String(patch.entityId).padStart(4, "0")}`,
    projectId: 1,
    href: `/tasks?open=${patch.entityId}`,
    state: "ready",
    progress: null,
    dueDate: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    signalAt: "2026-10-10T12:00:00.000Z",
    audience: "action",
    assigneeName: null,
    ...patch,
  };
}

describe("digest period", () => {
  it("waits until 07:00 local and still runs later the same day", () => {
    const early = digestPeriod(new Date("2026-10-14T06:59:00.000Z"), {
      frequency: "daily",
      timeZone: "UTC",
      hour: 7,
    });
    const open = digestPeriod(new Date("2026-10-14T07:00:00.000Z"), {
      frequency: "daily",
      timeZone: "UTC",
      hour: 7,
    });
    const later = digestPeriod(new Date("2026-10-14T18:00:00.000Z"), {
      frequency: "daily",
      timeZone: "UTC",
      hour: 7,
    });
    assert.equal(early.due, false);
    assert.equal(early.key, "2026-10-14");
    assert.equal(open.due, true);
    assert.equal(open.key, later.key);
    assert.equal(later.due, true);
  });

  it("uses one ISO week and catches up after Monday", () => {
    const mondayEarly = digestPeriod(new Date("2026-10-12T06:00:00.000Z"), {
      frequency: "weekly",
      timeZone: "UTC",
      hour: 7,
    });
    const monday = digestPeriod(new Date("2026-10-12T07:00:00.000Z"), {
      frequency: "weekly",
      timeZone: "UTC",
      hour: 7,
    });
    const wednesday = digestPeriod(new Date("2026-10-14T12:00:00.000Z"), {
      frequency: "weekly",
      timeZone: "UTC",
      hour: 7,
    });
    const previousSunday = digestPeriod(new Date("2026-10-11T18:00:00.000Z"), {
      frequency: "weekly",
      timeZone: "UTC",
      hour: 7,
    });
    assert.equal(mondayEarly.due, false);
    assert.equal(monday.due, true);
    assert.equal(wednesday.due, true);
    assert.equal(monday.key, wednesday.key);
    assert.notEqual(previousSunday.key, wednesday.key);
    assert.equal(isoWeek("2026-01-01").key, "2026-W01");
    assert.equal(isoWeek("2026-01-01").monday, "2025-12-29");
  });
});

describe("digest signals", () => {
  it("marks a past due date overdue and a slow progress share at risk", () => {
    assert.equal(
      digestSchedule({ state: "ready", dueDate: "2026-10-01" }, now, "UTC").kind,
      "overdue",
    );
    assert.equal(
      digestSchedule({ state: "complete", dueDate: "2026-10-01" }, now, "UTC").kind,
      "none",
    );
    assert.equal(
      digestSchedule(
        {
          state: "in_progress",
          dueDate: "2026-10-20",
          createdAt: "2026-09-01T12:00:00.000Z",
          progress: 10,
        },
        now,
        "UTC",
      ).kind,
      "risk",
    );
    assert.equal(
      digestSchedule(
        {
          state: "in_progress",
          dueDate: "2026-12-01",
          createdAt: "2026-10-01T12:00:00.000Z",
          progress: 80,
        },
        now,
        "UTC",
      ).kind,
      "ok",
    );
  });

  it("treats an update older than the threshold as stale", () => {
    assert.equal(
      digestStale({ state: "ready", signalAt: "2026-08-01T12:00:00.000Z" }, now, 30),
      true,
    );
    assert.equal(
      digestStale({ state: "complete", signalAt: "2026-08-01T12:00:00.000Z" }, now, 30),
      false,
    );
    assert.equal(
      digestStale({ state: "ready", signalAt: "2026-10-01T12:00:00.000Z" }, now, 30),
      false,
    );
  });
});

describe("digest classify", () => {
  it("keeps owned work assigned to someone else at the bottom", () => {
    const result = classifyDigest({
      subjects: [
        subject({ entityId: 1, title: "Mine", dueDate: "2026-10-01", audience: "action" }),
        subject({
          entityId: 2,
          title: "Delegated",
          dueDate: "2026-10-01",
          audience: "assigned_out",
          assigneeName: "Ada",
          state: "in_progress",
        }),
        subject({
          entityId: 3,
          title: "Finished",
          audience: "assigned_out",
          assigneeName: "Bea",
          state: "complete",
        }),
      ],
      changes: [],
      suggestions: [],
      duplicates: [],
      now,
      timeZone: "UTC",
      staleDays: 30,
      since: new Date("2026-10-14T00:00:00.000Z"),
      enabled,
    });
    assert.deepEqual(
      result.sections.overdue.map((item) => item.entityId),
      [1],
    );
    assert.equal(result.sections.assigned_out.length, 2);
    assert.equal(result.sections.assigned_out[0]?.reason, "Assigned to Ada · In Progress · overdue");
    assert.equal(result.sections.assigned_out[1]?.entityId, 3);
    assert.equal(DIGEST_SECTIONS[DIGEST_SECTIONS.length - 1], "assigned_out");
  });

  it("caps a section at 25 and reports the full count", () => {
    const subjects = Array.from({ length: 30 }, (_, index) =>
      subject({
        entityId: index + 1,
        title: `Task ${index + 1}`,
        dueDate: "2026-10-01",
      }),
    );
    const result = classifyDigest({
      subjects,
      changes: [],
      suggestions: [],
      duplicates: [],
      now,
      timeZone: "UTC",
      staleDays: 30,
      since: now,
      enabled,
    });
    assert.equal(result.sections.overdue.length, 25);
    assert.equal(result.counts.overdue, 30);
  });

  it("starts the change window at the previous digest, or the period start on the first run", () => {
    const periodStart = new Date("2026-10-14T00:00:00.000Z");
    const previous = new Date("2026-10-13T07:00:00.000Z");
    assert.equal(changeWindowStart(null, periodStart).toISOString(), periodStart.toISOString());
    assert.equal(changeWindowStart(previous, periodStart).toISOString(), previous.toISOString());
    const result = classifyDigest({
      subjects: [subject({ entityId: 4, title: "Edited" })],
      changes: [
        {
          entityType: "task",
          entityId: 4,
          at: "2026-10-13T12:00:00.000Z",
          reason: "state: Ready → In Progress",
        },
        {
          entityType: "task",
          entityId: 4,
          at: "2026-10-14T12:00:00.000Z",
          reason: "New comment",
        },
      ],
      suggestions: [],
      duplicates: [],
      now,
      timeZone: "UTC",
      staleDays: 30,
      since: periodStart,
      enabled,
    });
    assert.equal(result.sections.changed.length, 1);
    assert.equal(result.sections.changed[0]?.reason, "New comment");
  });

  it("drops a turned-off section", () => {
    const off = { ...enabled, overdue: false };
    const result = classifyDigest({
      subjects: [subject({ entityId: 1, title: "Late", dueDate: "2026-10-01" })],
      changes: [],
      suggestions: [],
      duplicates: [],
      now,
      timeZone: "UTC",
      staleDays: 30,
      since: now,
      enabled: off,
    });
    assert.equal(result.sections.overdue.length, 0);
    assert.equal(result.counts.overdue, 0);
  });
});

describe("digest summary facts", () => {
  it("leaves excluded project titles out of the prompt lines", () => {
    const sections = classifyDigest({
      subjects: [
        subject({ entityId: 1, title: "Visible", dueDate: "2026-10-01", projectId: 1 }),
        subject({ entityId: 2, title: "Hidden title", dueDate: "2026-10-01", projectId: 9 }),
      ],
      changes: [],
      suggestions: [],
      duplicates: [
        {
          entityType: "task",
          entityId: 3,
          referenceId: "T0003",
          title: "Open",
          projectId: 1,
          alsoProjectId: 9,
          href: "/tasks?open=3",
          reason: "Possible duplicate of T0009 Hidden title",
          score: 0.9,
        },
      ],
      now,
      timeZone: "UTC",
      staleDays: 30,
      since: now,
      enabled,
    }).sections;
    const lines = summaryFactLines(sections, new Set([9]));
    assert.match(lines.join("\n"), /Visible/);
    assert.doesNotMatch(lines.join("\n"), /Hidden title/);
    const withheld = withheldProjects(sections, new Map([[9, "excluded"], [1, "full"]]), new Map([[9, "Secret"]]));
    assert.deepEqual(withheld, [{ id: 9, name: "Secret" }]);
  });

  it("falls back to UTC and daily when prefs are empty", () => {
    const prefs = parseDigestPrefs({});
    assert.equal(prefs.frequency, "daily");
    assert.equal(prefs.timeZone, "UTC");
    assert.equal(prefs.hour, 7);
    assert.equal(prefs.summary, true);
    assert.equal(parseDigestPrefs({ timeZone: "Not/AZone" }).timeZone, "UTC");
    assert.equal(parseDigestPrefs({ summary: false, frequency: "weekly" }).summary, false);
    assert.equal(shouldSummarize({ enabled: false, featureOff: false, lineCount: 3 }), false);
    assert.equal(shouldSummarize({ enabled: true, featureOff: true, lineCount: 3 }), false);
    assert.equal(shouldSummarize({ enabled: true, featureOff: false, lineCount: 0 }), false);
    assert.equal(shouldSummarize({ enabled: true, featureOff: false, lineCount: 2 }), true);
  });
});
