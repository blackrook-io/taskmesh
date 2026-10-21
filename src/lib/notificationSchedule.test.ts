import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emailDeliverAt,
  isQuietHour,
  isValidTimeZone,
  shiftIsoDate,
  zonedParts,
} from "./notificationSchedule.js";

describe("notification schedule", () => {
  it("treats a same-day quiet window as half-open", () => {
    assert.equal(isQuietHour(21, 22, 7), false);
    assert.equal(isQuietHour(22, 22, 7), true);
    assert.equal(isQuietHour(2, 22, 7), true);
    assert.equal(isQuietHour(7, 22, 7), false);
    assert.equal(isQuietHour(8, 22, 7), false);
  });

  it("treats equal or missing bounds as no quiet hours", () => {
    assert.equal(isQuietHour(3, 3, 3), false);
    assert.equal(isQuietHour(3, null, 8), false);
  });

  it("reads a New York civil date", () => {
    const parts = zonedParts(new Date("2026-01-15T04:30:00.000Z"), "America/New_York");
    assert.equal(parts.date, "2026-01-14");
    assert.equal(parts.hour, 23);
    assert.equal(parts.minute, 30);
  });

  it("rejects an unknown time zone", () => {
    assert.equal(isValidTimeZone("America/New_York"), true);
    assert.equal(isValidTimeZone("Not/AZone"), false);
  });

  it("sends immediate mail now when the hour is outside quiet hours", () => {
    const now = new Date("2026-06-15T15:00:00.000Z");
    assert.equal(
      emailDeliverAt(now, {
        frequency: "immediate",
        quietStart: 22,
        quietEnd: 7,
        timeZone: "UTC",
      }),
      null,
    );
  });

  it("holds immediate mail until quiet hours end", () => {
    const now = new Date("2026-06-15T23:10:00.000Z");
    const at = emailDeliverAt(now, {
      frequency: "immediate",
      quietStart: 22,
      quietEnd: 7,
      timeZone: "UTC",
    });
    assert.equal(at?.toISOString(), "2026-06-16T07:00:00.000Z");
  });

  it("places a daily email at 08:00 local", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    const at = emailDeliverAt(now, {
      frequency: "daily",
      quietStart: null,
      quietEnd: null,
      timeZone: "UTC",
    });
    assert.equal(at?.toISOString(), "2026-06-16T08:00:00.000Z");
  });

  it("shifts an ISO date by whole days", () => {
    assert.equal(shiftIsoDate("2026-01-01", -1), "2025-12-31");
    assert.equal(shiftIsoDate("2026-01-01", 1), "2026-01-02");
  });
});
