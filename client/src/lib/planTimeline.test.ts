import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { axisTicks, barSegments, calendarDays } from "./planTimeline.ts";

describe("plan timeline geometry", () => {
  it("splits a Friday-to-Monday bar around the weekend", () => {
    const segments = barSegments(
      { start: "2026-10-16", end: "2026-10-19", startFraction: 0, endFraction: 1, actual: false },
      "2026-10-16",
      10,
    );
    assert.deepEqual(
      segments.map((segment) => segment.x),
      [0, calendarDays("2026-10-16", "2026-10-19") * 10],
    );
    assert.equal(segments.length, 2);
  });

  it("keeps a weekend day when the bar is an actual date", () => {
    const segments = barSegments(
      { start: "2026-10-17", end: "2026-10-17", startFraction: 0, endFraction: 1, actual: true },
      "2026-10-16",
      10,
    );
    assert.equal(segments.length, 1);
    assert.equal(segments[0]?.x, 10);
  });

  it("labels Mondays in week zoom", () => {
    const ticks = axisTicks("2026-10-14", "2026-10-26", "week");
    assert.deepEqual(
      ticks.map((tick) => tick.date),
      ["2026-10-19", "2026-10-26"],
    );
  });
});
