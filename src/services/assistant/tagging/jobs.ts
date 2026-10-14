import { db } from "../../../db/client.js";
import { isEntityType } from "../../../lib/entityType.js";
import type { JobDefinition } from "../../jobs/definitions.js";
import { registerJob } from "../../jobs/queue.js";
import { JOB_AI_TAG_RECORD } from "./jobNames.js";
import { runAutoTag } from "./service.js";

export const AI_TAG_RECORD_JOB: JobDefinition = {
  name: JOB_AI_TAG_RECORD,
  label: "AI tag record",
  retryLimit: 2,
  retryDelaySeconds: 30,
  retryBackoff: true,
  concurrency: 1,
  policy: "short",
  expireInSeconds: 120,
  cron: null,
};

export function registerTaggingJobs(): void {
  registerJob(AI_TAG_RECORD_JOB, (data) => tagRecordJob(data));
}

async function tagRecordJob(data: object): Promise<void> {
  const entityType = "entityType" in data ? data.entityType : null;
  const entityId = "entityId" in data ? data.entityId : null;
  if (typeof entityType !== "string" || !isEntityType(entityType)) return;
  if (typeof entityId !== "number" || !Number.isInteger(entityId) || entityId <= 0) return;
  try {
    await runAutoTag(db, entityType, entityId);
  } catch (err) {
    const code =
      err && typeof err === "object" && "cause" in err
        ? (err.cause as { code?: string } | undefined)?.code
        : (err as { code?: string } | null)?.code;
    if (code === "42P01") return;
    throw err;
  }
}
