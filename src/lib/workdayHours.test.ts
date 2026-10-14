import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWorkdayHours, workdayHoursSchema } from "./workdayHours.js";

describe("workdayHours", () => {
  it("accepts quarter-hours from 0.25 through 24", () => {
    assert.equal(workdayHoursSchema.safeParse(8).success, true);
    assert.equal(workdayHoursSchema.safeParse(0.25).success, true);
    assert.equal(workdayHoursSchema.safeParse(24).success, true);
    assert.equal(workdayHoursSchema.safeParse(0).success, false);
    assert.equal(workdayHoursSchema.safeParse(1.3).success, false);
    assert.equal(workdayHoursSchema.safeParse(24.25).success, false);
  });

  it("parses a cell the same way", () => {
    assert.equal(parseWorkdayHours("8"), 8);
    assert.equal(parseWorkdayHours(""), "invalid");
    assert.equal(parseWorkdayHours(0), "invalid");
  });
});
