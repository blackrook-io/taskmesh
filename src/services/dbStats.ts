import { asc, gte, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import {
  emptyTimeBuckets,
  type UsageRange,
} from "../lib/usageRange.js";
import { getApiUsageSummary } from "./apiRequestLogs.js";

type Db = NodePgDatabase<typeof schema>;

const SAMPLE_MS = 5 * 60 * 1000;
const RETAIN_MS = 35 * 24 * 60 * 60 * 1000;

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

export type DbStatsCurrent = {
  datname: string;
  databaseSizeBytes: number;
  tableCount: number;
  databaseCount: number;
  sampledAt: string | null;
};

export type DbStatsSeriesPoint = {
  t: string;
  databaseSizeBytes: number;
  tableCount: number;
  databaseCount: number;
  requestCount: number;
  requestBytes: number;
  responseBytes: number;
};

export type LiveDbStats = {
  datname: string;
  databaseSizeBytes: number;
  tableCount: number;
  databaseCount: number;
};

export async function readLiveDbStats(db: Db): Promise<LiveDbStats> {
  const result = await db.execute(sql`
    SELECT
      current_database() AS datname,
      pg_database_size(current_database()) AS database_size_bytes,
      (SELECT count(*)::int FROM pg_stat_user_tables) AS table_count
  `);
  const row = result.rows[0] as
    | { datname: string; database_size_bytes: string | number; table_count: number }
    | undefined;
  if (!row) {
    throw new Error("Could not read database stats");
  }
  return {
    datname: String(row.datname),
    databaseSizeBytes: Number(row.database_size_bytes),
    tableCount: Number(row.table_count),
    databaseCount: 1,
  };
}

export async function recordDbStatsSnapshot(db: Db): Promise<void> {
  const live = await readLiveDbStats(db);
  await db.insert(schema.dbStatsSnapshots).values({
    sampledAt: new Date(),
    databaseSizeBytes: live.databaseSizeBytes,
    tableCount: live.tableCount,
    databaseCount: live.databaseCount,
    datname: live.datname,
  });
  const cutoff = new Date(Date.now() - RETAIN_MS);
  await db
    .delete(schema.dbStatsSnapshots)
    .where(lt(schema.dbStatsSnapshots.sampledAt, cutoff));
}

export type GaugeSample = {
  sampledAt: Date;
  databaseSizeBytes: number;
  tableCount: number;
  databaseCount: number;
};

export function applyGaugeSamples(
  series: Array<{
    databaseSizeBytes: number;
    tableCount: number;
    databaseCount: number;
  }>,
  samples: GaugeSample[],
  bucketStart: number,
  step: number,
): void {
  const lastByIdx = new Map<number, GaugeSample>();
  for (const sample of samples) {
    const idx = Math.floor((sample.sampledAt.getTime() - bucketStart) / step);
    if (idx < 0 || idx >= series.length) continue;
    lastByIdx.set(idx, sample);
  }
  let last: GaugeSample | null = null;
  for (let i = 0; i < series.length; i++) {
    const hit = lastByIdx.get(i);
    if (hit) last = hit;
    if (!last) continue;
    const point = series[i]!;
    point.databaseSizeBytes = last.databaseSizeBytes;
    point.tableCount = last.tableCount;
    point.databaseCount = last.databaseCount;
  }
}

export async function getDatabaseStatsSummary(
  db: Db,
  range: UsageRange,
): Promise<{
  range: UsageRange;
  current: DbStatsCurrent;
  series: DbStatsSeriesPoint[];
}> {
  const live = await readLiveDbStats(db);
  const now = Date.now();
  const { bucketStart, step, series } = emptyTimeBuckets(
    range,
    (t) => ({
      t: t.toISOString(),
      databaseSizeBytes: 0,
      tableCount: 0,
      databaseCount: 0,
      requestCount: 0,
      requestBytes: 0,
      responseBytes: 0,
    }),
    now,
  );

  const snapshots = await db
    .select({
      sampledAt: schema.dbStatsSnapshots.sampledAt,
      databaseSizeBytes: schema.dbStatsSnapshots.databaseSizeBytes,
      tableCount: schema.dbStatsSnapshots.tableCount,
      databaseCount: schema.dbStatsSnapshots.databaseCount,
    })
    .from(schema.dbStatsSnapshots)
    .where(gte(schema.dbStatsSnapshots.sampledAt, new Date(bucketStart)))
    .orderBy(asc(schema.dbStatsSnapshots.sampledAt));

  applyGaugeSamples(series, snapshots, bucketStart, step);

  const usage = await getApiUsageSummary(db, range, now);
  const usageByT = new Map(usage.series.map((p) => [p.t, p]));
  for (const point of series) {
    const u = usageByT.get(point.t);
    if (!u) continue;
    point.requestCount = u.success + u.apiFailure + u.authFailure + u.accessViolation;
    point.requestBytes = u.requestBytes;
    point.responseBytes = u.responseBytes;
  }

  const latest = snapshots[snapshots.length - 1];
  return {
    range,
    current: {
      datname: live.datname,
      databaseSizeBytes: live.databaseSizeBytes,
      tableCount: live.tableCount,
      databaseCount: live.databaseCount,
      sampledAt: latest?.sampledAt.toISOString() ?? null,
    },
    series,
  };
}

export function startDbStatsSampler(db: Db): void {
  if (schedulerTimer) return;
  const tick = () => {
    void recordDbStatsSnapshot(db).catch((err) => {
      console.error("db_stats_snapshot failed", err);
    });
  };
  schedulerTimer = setInterval(tick, SAMPLE_MS);
  tick();
}

export function stopDbStatsSampler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
