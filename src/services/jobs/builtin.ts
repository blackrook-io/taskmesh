import { db } from "../../db/client.js";
import { pruneApiRequestLogs } from "../apiRequestLogPrune.js";
import { runBackup } from "../backups.js";
import { recordDbStatsSnapshot } from "../dbStats.js";
import { JOB_BACKUP, JOB_DB_STATS, JOB_PRUNE_API_LOGS } from "./definitions.js";

export type JobContext = {
  id: string;
  retryCount: number;
  retryLimit: number;
};

export type JobHandler = (data: object, job?: JobContext) => Promise<void>;

async function runScheduledBackup(): Promise<void> {
  const manifest = await runBackup();
  if (!manifest.pgDumpOk || !manifest.uploadsOk) {
    throw new Error(manifest.error ?? "Scheduled backup failed");
  }
}

export const builtinHandlers: Record<string, JobHandler> = {
  [JOB_BACKUP]: async () => {
    await runScheduledBackup();
  },
  [JOB_PRUNE_API_LOGS]: async () => {
    await pruneApiRequestLogs(db);
  },
  [JOB_DB_STATS]: async () => {
    await recordDbStatsSnapshot(db);
  },
};
