import type { JobDefinition } from "../jobs/definitions.js";
import { enqueue, registerJob } from "../jobs/queue.js";
import { db } from "../../db/client.js";
import { parseDigestPrefs } from "../../lib/digest.js";
import { digestPeriod } from "../../lib/digestSignals.js";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { deliverStoredDigest } from "./mail.js";
import { buildDigest } from "./service.js";

export const JOB_DIGEST_SCAN = "digest-scan";
export const JOB_DIGEST_BUILD = "digest-build";

export const DIGEST_SCAN_JOB: JobDefinition = {
  name: JOB_DIGEST_SCAN,
  label: "Attention digest scan",
  retryLimit: 3,
  retryDelaySeconds: 60,
  retryBackoff: true,
  concurrency: 1,
  policy: "short",
  expireInSeconds: 30 * 60,
  cron: "0 * * * *",
};

export const DIGEST_BUILD_JOB: JobDefinition = {
  name: JOB_DIGEST_BUILD,
  label: "Attention digest build",
  retryLimit: 3,
  retryDelaySeconds: 60,
  retryBackoff: true,
  concurrency: 1,
  policy: "short",
  expireInSeconds: 20 * 60,
  cron: null,
};

export function registerDigestJobs(): void {
  registerJob(DIGEST_SCAN_JOB, () => scanDigests());
  registerJob(DIGEST_BUILD_JOB, (data) => buildDigestJob(data));
}

export async function scanDigests(): Promise<void> {
  const users = await db
    .select({ id: schema.users.id, digestPrefs: schema.users.digestPrefs })
    .from(schema.users)
    .where(and(isNull(schema.users.deactivatedAt), isNull(schema.users.lockedAt)));
  const now = new Date();
  for (const user of users) {
    try {
      const prefs = parseDigestPrefs(user.digestPrefs);
      const period = digestPeriod(now, prefs);
      if (!period.due) continue;
      const [existing] = await db
        .select({ id: schema.attentionDigests.id, emailedAt: schema.attentionDigests.emailedAt })
        .from(schema.attentionDigests)
        .where(and(eq(schema.attentionDigests.userId, user.id), eq(schema.attentionDigests.periodKey, period.key)))
        .limit(1);
      if (existing) {
        if (!existing.emailedAt) await deliverStoredDigest(db, user.id, existing.id);
        continue;
      }
      await enqueue(JOB_DIGEST_BUILD, { userId: user.id, periodKey: period.key }, {
        singletonKey: `${user.id}:${period.key}`,
      });
    } catch (err) {
      console.error("[digest] scan user failed", user.id, err);
    }
  }
}

async function buildDigestJob(data: object): Promise<void> {
  const userId = "userId" in data ? data.userId : null;
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) return;
  const digest = await buildDigest(db, userId, { replace: false });
  if (!digest) return;
  await deliverStoredDigest(db, userId, digest.id);
}
