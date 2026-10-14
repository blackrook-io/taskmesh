import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateHoursMatches, formatEstimateHours, parseEstimateHours } from "./estimateHours.js";
import { estimateHoursSchema } from "./taskFields.js";

describe("estimate hours", () => {
  it("accepts quarter hours and rejects 1.3", () => {
    assert.equal(estimateHoursSchema.safeParse(1.25).success, true);
    assert.equal(estimateHoursSchema.safeParse(0).success, true);
    assert.equal(estimateHoursSchema.safeParse(999.75).success, true);
    assert.equal(estimateHoursSchema.safeParse(null).success, true);
    assert.equal(estimateHoursSchema.safeParse(undefined).success, true);
    assert.equal(estimateHoursSchema.safeParse(1.3).success, false);
    assert.equal(estimateHoursSchema.safeParse(-0.25).success, false);
    assert.equal(estimateHoursSchema.safeParse(1000).success, false);
  });

  it("parses empty cells as null and rejects bad spreadsheet values", () => {
    assert.equal(parseEstimateHours(""), null);
    assert.equal(parseEstimateHours(null), null);
    assert.equal(parseEstimateHours("1.25"), 1.25);
    assert.equal(parseEstimateHours(0), 0);
    assert.equal(parseEstimateHours("1.3"), "invalid");
    assert.equal(parseEstimateHours("nope"), "invalid");
  });

  it("matches list filters and keeps unset values out of numeric compares", () => {
    assert.equal(estimateHoursMatches(1.25, "is", "1.25"), true);
    assert.equal(estimateHoursMatches(1.25, "is", "1.3"), false);
    assert.equal(estimateHoursMatches(2, "gt", "1.25"), true);
    assert.equal(estimateHoursMatches(1, "lt", "1.25"), true);
    assert.equal(estimateHoursMatches(null, "gt", "0"), false);
    assert.equal(estimateHoursMatches(null, "is_empty", ""), true);
    assert.equal(estimateHoursMatches(0, "is_not_empty", ""), true);
    assert.equal(estimateHoursMatches(0, "is_empty", ""), false);
  });

  it("formats stored hours without trailing zeros", () => {
    assert.equal(formatEstimateHours(null), "");
    assert.equal(formatEstimateHours(0), "0");
    assert.equal(formatEstimateHours(1.5), "1.5");
    assert.equal(formatEstimateHours(1.25), "1.25");
  });
});