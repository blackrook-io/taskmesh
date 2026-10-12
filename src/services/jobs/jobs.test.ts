import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILTIN_JOBS,
  JOB_BACKUP,
  JOB_DB_STATS,
  JOB_PRUNE_API_LOGS,
  backupCron,
  requireJob,
} from "./definitions.js";
import { enqueue } from "./queue.js";

describe("backupCron", () => {
  it("uses the saved hour and minute", () => {
    assert.equal(backupCron({ enabled: true, hour: 3, minute: 0 }), "0 3 * * *");
    assert.equal(backupCron({ enabled: true, hour: 15, minute: 7 }), "7 15 * * *");
  });

  it("returns null when the schedule is disabled", () => {
    assert.equal(backupCron({ enabled: false, hour: 3, minute: 0 }), null);
  });
});

describe("builtin job policies", () => {
  it("retries with concurrency 1", () => {
    assert.equal(BUILTIN_JOBS.length, 3);
    for (const job of BUILTIN_JOBS) {
      assert.equal(job.concurrency, 1);
      assert.ok(job.retryLimit >= 1);
      assert.equal(job.policy, "short");
    }
    const backup = requireJob(JOB_BACKUP);
    assert.equal(backup.retryLimit, 3);
    assert.equal(backup.retryBackoff, true);
    assert.equal(backup.backupSchedule, true);
    const prune = requireJob(JOB_PRUNE_API_LOGS);
    assert.equal(prune.retryLimit, 3);
    assert.equal(prune.retryBackoff, true);
    assert.equal(prune.cron, "0 */6 * * *");
    const stats = requireJob(JOB_DB_STATS);
    assert.equal(stats.retryLimit, 1);
    assert.equal(stats.retryBackoff, false);
    assert.equal(stats.cron, "*/5 * * * *");
  });
});

describe("enqueue", () => {
  it("rejects an unknown job name", async () => {
    await assert.rejects(() => enqueue("not-a-job", {}), /Unknown job: not-a-job/);
  });
});
