import { db } from "../../../db/client.js";
import { isEntityType } from "../../../lib/entityType.js";
import type { JobDefinition } from "../../jobs/definitions.js";
import { registerJob } from "../../jobs/queue.js";
import { DUPLICATE_SWEEP_CRON, JOB_AI_DUPLICATE_RECORD, JOB_AI_DUPLICATE_SWEEP } from "./jobNames.js";
import { runDuplicateCheck, sweepDuplicateChecks } from "./service.js";

export const AI_DUPLICATE_RECORD_JOB: JobDefinition = {
  name: JOB_AI_DUPLICATE_RECORD,
  label: "AI duplicate check",
  retryLimit: 2,
  retryDelaySeconds: 30,
  retryBackoff: true,
  concurrency: 1,
  policy: "short",
  expireInSeconds: 120,
  cron: null,
};

export const AI_DUPLICATE_SWEEP_JOB: JobDefinition = {
  name: JOB_AI_DUPLICATE_SWEEP,
  label: "AI duplicate sweep",
  retryLimit: 1,
  retryDelaySeconds: 60,
  retryBackoff: false,
  concurrency: 1,
  policy: "short",
  expireInSeconds: 30 * 60,
  cron: DUPLICATE_SWEEP_CRON,
};

export function registerDuplicateJobs(): void {
  registerJob(AI_DUPLICATE_RECORD_JOB, (data) => duplicateRecordJob(data));
  registerJob(AI_DUPLICATE_SWEEP_JOB, () => sweepDuplicateChecks(db));
}

async function duplicateRecordJob(data: object): Promise<void> {
  const entityType = "entityType" in data ? data.entityType : null;
  const entityId = "entityId" in data ? data.entityId : null;
  if (typeof entityType !== "string" || !isEntityType(entityType)) return;
  if (typeof entityId !== "number" || !Number.isInteger(entityId) || entityId <= 0) return;
  try {
    await runDuplicateCheck(db, entityType, entityId);
  } catch (err) {
    const code =
      err && typeof err === "object" && "cause" in err
        ? (err.cause as { code?: string } | undefined)?.code
        : (err as { code?: string } | null)?.code;
    if (code === "42P01") return;
    throw err;
  }
}
