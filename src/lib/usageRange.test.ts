import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bucketMs,
  emptyTimeBuckets,
  isUsageRange,
  rangeMs,
} from "./usageRange.js";
import { applyGaugeSamples } from "../services/dbStats.js";

describe("usageRange", () => {
  it("accepts 1h 1d 1w 1m only", () => {
    assert.equal(isUsageRange("1h"), true);
    assert.equal(isUsageRange("1m"), true);
    assert.equal(isUsageRange("1y"), false);
  });

  it("uses a 30-day window and 1-day buckets for 1m", () => {
    assert.equal(rangeMs("1m"), 30 * 24 * 60 * 60 * 1000);
    assert.equal(bucketMs("1m"), 24 * 60 * 60 * 1000);
  });

  it("builds contiguous buckets covering the window", () => {
    const now = Date.parse("2026-08-25T12:00:00.000Z");
    const { series, step } = emptyTimeBuckets("1h", (t) => t.toISOString(), now);
    assert.equal(step, 5 * 60 * 1000);
    assert.ok(series.length >= 12);
    assert.ok(Date.parse(series[0]!) <= now - rangeMs("1h") + step);
    assert.ok(Date.parse(series[series.length - 1]!) <= now + step);
  });
});

describe("applyGaugeSamples", () => {
  it("forward-fills after the first sample in range", () => {
    const now = Date.parse("2026-08-25T12:00:00.000Z");
    const { series, bucketStart, step } = emptyTimeBuckets(
      "1h",
      (t) => ({
        t: t.toISOString(),
        databaseSizeBytes: 0,
        tableCount: 0,
        databaseCount: 0,
      }),
      now,
    );
    const mid = new Date(bucketStart + step * 3);
    applyGaugeSamples(
      series,
      [
        {
          sampledAt: mid,
          databaseSizeBytes: 9000,
          tableCount: 12,
          databaseCount: 1,
        },
      ],
      bucketStart,
      step,
    );
    assert.equal(series[2]!.databaseSizeBytes, 0);
    assert.equal(series[3]!.databaseSizeBytes, 9000);
    assert.equal(series[3]!.tableCount, 12);
    assert.equal(series[series.length - 1]!.databaseSizeBytes, 9000);
    assert.equal(series[series.length - 1]!.databaseCount, 1);
  });
});
