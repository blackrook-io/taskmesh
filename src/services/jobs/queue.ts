import PgBoss from "pg-boss";
import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { emptyTimeBuckets, type UsageRange } from "../../lib/usageRange.js";
import { readSchedule } from "../backups.js";
import { builtinHandlers, type JobHandler } from "./builtin.js";
import {
  JOB_BACKUP,
  PGBOSS_SCHEMA,
  addJobDefinition,
  allJobs,
  backupCron,
  hostTimeZone,
  jobLabel,
  requireJob,
  type JobDefinition,
} from "./definitions.js";
import { setBackupScheduleListener, type BackupScheduleSnapshot } from "./scheduleHook.js";

const STOP_TIMEOUT_MS = 4000;
/** Keep failed jobs on the live table long enough to show in Administration → Jobs. */
const ARCHIVE_FAILED_AFTER_SECONDS = 14 * 24 * 60 * 60;
/** Completed rows move to archive, then both stay until this window so charts can cover 1m. */
const DELETE_AFTER_DAYS = 32;

const handlers = new Map<string, JobHandler>(Object.entries(builtinHandlers));

let bossRef: PgBoss | null = null;
let starting: Promise<void> | null = null;
let queueReady = false;

export class JobQueueError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "JobQueueError";
    this.status = status;
    this.code = code;
  }
}

export function registerJob(def: JobDefinition, handler: JobHandler): void {
  if (starting || queueReady) {
    throw new Error("Register jobs before the queue starts");
  }
  addJobDefinition(def);
  handlers.set(def.name, handler);
}

export async function enqueue(
  name: string,
  data: object,
  options?: { singletonKey?: string },
): Promise<string | null> {
  const job = requireJob(name);
  const boss = bossRef;
  if (!boss || !queueReady) throw new Error("Job queue is not running");
  return boss.send(name, data, {
    singletonKey: options?.singletonKey,
    retryLimit: job.retryLimit,
    retryDelay: job.retryDelaySeconds,
    retryBackoff: job.retryBackoff,
  });
}

export function startJobQueue(): Promise<void> {
  if (starting) return starting;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return Promise.reject(new Error("DATABASE_URL is required"));
  }
  starting = startBoss(connectionString).catch((err) => {
    starting = null;
    queueReady = false;
    bossRef = null;
    throw err;
  });
  return starting;
}

export async function stopJobQueue(): Promise<void> {
  if (starting) {
    try {
      await starting;
    } catch {
      // Start failed; nothing to stop.
    }
  }
  const boss = bossRef;
  bossRef = null;
  queueReady = false;
  starting = null;
  setBackupScheduleListener(null);
  if (!boss) return;
  await boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS, close: true });
}

async function startBoss(connectionString: string): Promise<void> {
  const boss = new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    application_name: "taskmesh-jobs",
    archiveFailedAfterSeconds: ARCHIVE_FAILED_AFTER_SECONDS,
    deleteAfterDays: DELETE_AFTER_DAYS,
  });
  boss.on("error", (err) => {
    console.error("[jobs]", err);
  });
  bossRef = boss;
  try {
    await boss.start();
    const tz = hostTimeZone();
    for (const job of allJobs()) {
      const options = queueOptions(job);
      await boss.createQueue(job.name, options);
      await boss.updateQueue(job.name, options);
      const handler = handlers.get(job.name);
      if (!handler) throw new Error(`No handler for job ${job.name}`);
      await boss.work(job.name, { batchSize: job.concurrency }, async (jobs) => {
        for (const item of jobs) {
          await handler(item.data ?? {});
        }
      });
      if (job.cron) {
        await boss.schedule(job.name, job.cron, {}, { tz });
      }
    }
    setBackupScheduleListener((schedule) => {
      void applyBackupSchedule(schedule).catch((err) => {
        console.error("[jobs] backup schedule update failed", err);
      });
    });
    await applyBackupSchedule(readSchedule());
    for (const job of allJobs()) {
      if (job.runOnStartAfterSeconds == null) continue;
      await boss.sendAfter(job.name, {}, {}, job.runOnStartAfterSeconds);
    }
    queueReady = true;
    console.log("[jobs] queue started");
  } catch (err) {
    queueReady = false;
    setBackupScheduleListener(null);
    try {
      await boss.stop({ graceful: false, timeout: 1000, close: true });
    } catch (stopErr) {
      console.error("[jobs] cleanup after start failure failed", stopErr);
    }
    throw err;
  }
}

function queueOptions(job: JobDefinition): PgBoss.Queue {
  return {
    name: job.name,
    policy: job.policy,
    retryLimit: job.retryLimit,
    retryDelay: job.retryDelaySeconds,
    retryBackoff: job.retryBackoff,
    expireInSeconds: job.expireInSeconds,
  };
}

async function applyBackupSchedule(schedule: BackupScheduleSnapshot): Promise<void> {
  const boss = bossRef;
  if (!boss) return;
  const cron = backupCron(schedule);
  if (!cron) {
    await boss.unschedule(JOB_BACKUP);
    return;
  }
  await boss.schedule(JOB_BACKUP, cron, {}, { tz: hostTimeZone() });
}

export type JobQueueCounts = {
  name: string;
  label: string;
  created: number;
  active: number;
  retry: number;
  failed: number;
};

export type JobActivityPoint = {
  t: string;
  completed: number;
  failed: number;
};

export type FailedJobRow = {
  id: string;
  name: string;
  label: string;
  retryCount: number;
  createdOn: string;
  completedOn: string | null;
  error: string | null;
};

export type JobAdminSummary = {
  range: UsageRange;
  queues: JobQueueCounts[];
  series: JobActivityPoint[];
  failedJobs: FailedJobRow[];
};

export async function getJobAdminSummary(range: UsageRange): Promise<JobAdminSummary> {
  try {
    const [counts, activity, failedJobs] = await Promise.all([
      readQueueCounts(),
      readActivity(range),
      readFailedJobs(),
    ]);
    return { range, queues: counts, series: activity, failedJobs };
  } catch (err) {
    if (postgresCode(err) === "42P01") {
      throw new JobQueueError(503, "job_queue_unavailable", "Job queue is not available");
    }
    throw err;
  }
}

export async function retryFailedJob(id: string): Promise<void> {
  const boss = requireRunningBoss();
  const row = await readJob(id);
  if (!row || row.state !== "failed") {
    throw new JobQueueError(404, "not_found", "Failed job not found");
  }
  const result = await boss.retry(row.name, id);
  if (affectedCount(result) < 1) {
    throw new JobQueueError(404, "not_found", "Failed job not found");
  }
}

export async function deleteFailedJob(id: string): Promise<void> {
  const boss = requireRunningBoss();
  const row = await readJob(id);
  if (!row || row.state !== "failed") {
    throw new JobQueueError(404, "not_found", "Failed job not found");
  }
  const result = await boss.deleteJob(row.name, id);
  if (affectedCount(result) < 1) {
    throw new JobQueueError(404, "not_found", "Failed job not found");
  }
}

function requireRunningBoss(): PgBoss {
  if (!bossRef || !queueReady) {
    throw new JobQueueError(503, "job_queue_unavailable", "Job queue is not running");
  }
  return bossRef;
}

type CountRow = { name: string; state: string; n: number };
type ActivityRow = { state: string; completed_on: Date | string };
type FailedSqlRow = {
  id: string;
  name: string;
  retry_count: number;
  created_on: Date | string;
  completed_on: Date | string | null;
  output: unknown;
};
type JobSqlRow = { name: string; state: string };

async function readQueueCounts(): Promise<JobQueueCounts[]> {
  const result = await db.execute<CountRow>(sql`
    SELECT name, state, count(*)::int AS n
    FROM pgboss.job
    WHERE state IN ('created', 'active', 'retry', 'failed')
    GROUP BY name, state
  `);
  const byName = new Map<string, JobQueueCounts>();
  for (const job of allJobs()) {
    byName.set(job.name, {
      name: job.name,
      label: job.label,
      created: 0,
      active: 0,
      retry: 0,
      failed: 0,
    });
  }
  for (const row of result.rows) {
    const entry = byName.get(row.name) ?? {
      name: row.name,
      label: jobLabel(row.name),
      created: 0,
      active: 0,
      retry: 0,
      failed: 0,
    };
    const count = Number(row.n);
    if (row.state === "created") entry.created = count;
    else if (row.state === "active") entry.active = count;
    else if (row.state === "retry") entry.retry = count;
    else if (row.state === "failed") entry.failed = count;
    byName.set(row.name, entry);
  }
  return [...byName.values()];
}

async function readActivity(range: UsageRange): Promise<JobActivityPoint[]> {
  const { bucketStart, step, series } = emptyTimeBuckets(range, (t) => ({
    t: t.toISOString(),
    completed: 0,
    failed: 0,
  }));
  const since = new Date(bucketStart);
  const result = await db.execute<ActivityRow>(sql`
    SELECT state, completed_on
    FROM pgboss.job
    WHERE state IN ('completed', 'failed')
      AND completed_on >= ${since}
    UNION ALL
    SELECT state, completed_on
    FROM pgboss.archive
    WHERE state IN ('completed', 'failed')
      AND completed_on >= ${since}
  `);
  for (const row of result.rows) {
    const ms = new Date(row.completed_on).getTime();
    if (!Number.isFinite(ms)) continue;
    const index = Math.floor((ms - bucketStart) / step);
    const point = series[index];
    if (!point) continue;
    if (row.state === "completed") point.completed += 1;
    else if (row.state === "failed") point.failed += 1;
  }
  return series;
}

async function readFailedJobs(): Promise<FailedJobRow[]> {
  const result = await db.execute<FailedSqlRow>(sql`
    SELECT id::text AS id,
           name,
           retry_count,
           created_on,
           completed_on,
           output
    FROM pgboss.job
    WHERE state = 'failed'
    ORDER BY completed_on DESC NULLS LAST
    LIMIT 50
  `);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    label: jobLabel(row.name),
    retryCount: Number(row.retry_count),
    createdOn: toIso(row.created_on),
    completedOn: row.completed_on ? toIso(row.completed_on) : null,
    error: outputMessage(row.output),
  }));
}

async function readJob(id: string): Promise<JobSqlRow | null> {
  const result = await db.execute<JobSqlRow>(sql`
    SELECT name, state
    FROM pgboss.job
    WHERE id = ${id}::uuid
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function outputMessage(output: unknown): string | null {
  if (output == null) return null;
  if (typeof output === "string") return output.slice(0, 300);
  if (typeof output === "object") {
    const record = output as Record<string, unknown>;
    const message = record.message ?? record.error;
    if (typeof message === "string") return message.slice(0, 300);
    try {
      return JSON.stringify(output).slice(0, 300);
    } catch {
      return null;
    }
  }
  return String(output).slice(0, 300);
}

function affectedCount(result: unknown): number {
  if (typeof result === "object" && result !== null && "affected" in result) {
    const affected = (result as { affected: unknown }).affected;
    if (typeof affected === "number" && Number.isFinite(affected)) return affected;
  }
  return 0;
}

function postgresCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ("code" in current && typeof (current as { code: unknown }).code === "string") {
      return (current as { code: string }).code;
    }
    current = "cause" in current ? (current as { cause: unknown }).cause : null;
  }
  return null;
}
