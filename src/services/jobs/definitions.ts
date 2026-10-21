export const PGBOSS_SCHEMA = "pgboss";

export const JOB_BACKUP = "backup-scheduled";
export const JOB_PRUNE_API_LOGS = "logs-prune-api-requests";
export const JOB_DB_STATS = "stats-sample-db";

/** Every 5 minutes, matching the previous in-process sampler. */
export const DB_STATS_CRON = "*/5 * * * *";
/** Every 6 hours at minute 0, matching the previous prune interval. */
export const API_LOG_PRUNE_CRON = "0 */6 * * *";

export type QueuePolicy = "standard" | "short" | "singleton" | "stately";

export type JobDefinition = {
  name: string;
  label: string;
  retryLimit: number;
  /** Seconds before a retry. Backoff multiplies this. */
  retryDelaySeconds: number;
  retryBackoff: boolean;
  /** Worker batch size. 1 keeps a single handler in flight for that queue. */
  concurrency: number;
  /**
   * `short` skips a new job when one with the same singleton key is already queued.
   * Callers pass `singletonKey` on enqueue for per-record dedupe.
   */
  policy: QueuePolicy;
  expireInSeconds: number;
  /** Cron in the host timezone. Null when the schedule comes from elsewhere. */
  cron: string | null;
  /** Install cron from the backup schedule file instead of `cron`. */
  backupSchedule?: boolean;
  /** Send one job this many seconds after the worker starts. */
  runOnStartAfterSeconds?: number;
  /** Pass pg-boss retry metadata into the handler. */
  includeMetadata?: boolean;
};

export const BUILTIN_JOBS: readonly JobDefinition[] = [
  {
    name: JOB_BACKUP,
    label: "Scheduled backup",
    retryLimit: 3,
    retryDelaySeconds: 60,
    retryBackoff: true,
    concurrency: 1,
    policy: "short",
    expireInSeconds: 2 * 60 * 60,
    cron: null,
    backupSchedule: true,
  },
  {
    name: JOB_PRUNE_API_LOGS,
    label: "API log prune",
    retryLimit: 3,
    retryDelaySeconds: 60,
    retryBackoff: true,
    concurrency: 1,
    policy: "short",
    expireInSeconds: 30 * 60,
    cron: API_LOG_PRUNE_CRON,
    runOnStartAfterSeconds: 30,
  },
  {
    name: JOB_DB_STATS,
    label: "Database stats sample",
    retryLimit: 1,
    retryDelaySeconds: 30,
    retryBackoff: false,
    concurrency: 1,
    policy: "short",
    expireInSeconds: 10 * 60,
    cron: DB_STATS_CRON,
    runOnStartAfterSeconds: 5,
  },
];

const extras: JobDefinition[] = [];

export function allJobs(): JobDefinition[] {
  return [...BUILTIN_JOBS, ...extras];
}

export function addJobDefinition(def: JobDefinition): void {
  if (allJobs().some((job) => job.name === def.name)) {
    throw new Error(`Job already registered: ${def.name}`);
  }
  extras.push(def);
}

export function requireJob(name: string): JobDefinition {
  const job = allJobs().find((item) => item.name === name);
  if (!job) throw new Error(`Unknown job: ${name}`);
  return job;
}

export function jobLabel(name: string): string {
  return allJobs().find((job) => job.name === name)?.label ?? name;
}

/** Cron for the backup schedule, or null when the schedule is disabled. */
export function backupCron(schedule: {
  enabled: boolean;
  hour: number;
  minute: number;
}): string | null {
  if (!schedule.enabled) return null;
  return `${schedule.minute} ${schedule.hour} * * *`;
}

export function hostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
