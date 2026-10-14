import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DIGEST_BUILD_JOB, DIGEST_SCAN_JOB } from "./jobs.js";

describe("digest jobs", () => {
  it("scans every hour and builds one user at a time", () => {
    assert.equal(DIGEST_SCAN_JOB.cron, "0 * * * *");
    assert.equal(DIGEST_SCAN_JOB.policy, "short");
    assert.equal(DIGEST_SCAN_JOB.concurrency, 1);
    assert.equal(DIGEST_BUILD_JOB.cron, null);
    assert.equal(DIGEST_BUILD_JOB.concurrency, 1);
    assert.equal(DIGEST_BUILD_JOB.retryBackoff, true);
  });
});
