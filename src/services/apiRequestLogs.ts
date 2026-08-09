import { and, asc, desc, eq, gte, ilike, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

export type ApiLogOutcome =
  | "success"
  | "api_failure"
  | "auth_failure"
  | "access_violation";

export type UsageRange = "1h" | "1d" | "1w";

export type ApiRequestLogInput = {
  outcome: ApiLogOutcome;
  method: string;
  path: string;
  statusCode: number;
  ip?: string | null;
  userId?: number | null;
  apiKeyId?: number | null;
  message?: string | null;
  adminKey?: boolean;
};

export async function insertApiRequestLog(
  db: Db,
  input: ApiRequestLogInput,
): Promise<void> {
  await db.insert(schema.apiRequestLogs).values({
    outcome: input.outcome,
    method: input.method,
    path: input.path.slice(0, 500),
    statusCode: input.statusCode,
    ip: input.ip ?? null,
    userId: input.userId ?? null,
    apiKeyId: input.apiKeyId ?? null,
    message: input.message?.slice(0, 500) ?? null,
    adminKey: input.adminKey ?? false,
  });
}

function rangeMs(range: UsageRange): number {
  switch (range) {
    case "1h":
      return 60 * 60 * 1000;
    case "1d":
      return 24 * 60 * 60 * 1000;
    case "1w":
      return 7 * 24 * 60 * 60 * 1000;
  }
}

function bucketMs(range: UsageRange): number {
  switch (range) {
    case "1h":
      return 5 * 60 * 1000; // 5m buckets
    case "1d":
      return 60 * 60 * 1000; // 1h
    case "1w":
      return 6 * 60 * 60 * 1000; // 6h
  }
}

export type UsageSeriesPoint = {
  t: string;
  success: number;
  apiFailure: number;
  authFailure: number;
  accessViolation: number;
};

export async function getApiUsageSummary(
  db: Db,
  range: UsageRange,
): Promise<{ range: UsageRange; series: UsageSeriesPoint[] }> {
  const now = Date.now();
  const since = new Date(now - rangeMs(range));
  const step = bucketMs(range);

  const rows = await db
    .select({
      createdAt: schema.apiRequestLogs.createdAt,
      outcome: schema.apiRequestLogs.outcome,
    })
    .from(schema.apiRequestLogs)
    .where(gte(schema.apiRequestLogs.createdAt, since))
    .orderBy(asc(schema.apiRequestLogs.createdAt));

  const bucketStart = Math.floor(since.getTime() / step) * step;
  const bucketCount = Math.ceil((now - bucketStart) / step) + 1;
  const series: UsageSeriesPoint[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const t = new Date(bucketStart + i * step);
    series.push({
      t: t.toISOString(),
      success: 0,
      apiFailure: 0,
      authFailure: 0,
      accessViolation: 0,
    });
  }

  for (const row of rows) {
    const idx = Math.floor((row.createdAt.getTime() - bucketStart) / step);
    if (idx < 0 || idx >= series.length) continue;
    const point = series[idx]!;
    switch (row.outcome) {
      case "success":
        point.success += 1;
        break;
      case "api_failure":
        point.apiFailure += 1;
        break;
      case "auth_failure":
        point.authFailure += 1;
        break;
      case "access_violation":
        point.accessViolation += 1;
        break;
    }
  }

  return { range, series };
}

export type ApiLogListItem = {
  id: number;
  createdAt: string;
  outcome: string;
  method: string;
  path: string;
  statusCode: number;
  ip: string | null;
  userId: number | null;
  apiKeyId: number | null;
  message: string | null;
  adminKey: boolean;
};

export async function listApiRequestLogs(
  db: Db,
  opts: {
    limit: number;
    offset: number;
    outcome?: ApiLogOutcome;
    pathContains?: string;
    since?: Date;
    until?: Date;
  },
): Promise<{ data: ApiLogListItem[]; total: number }> {
  const conditions = [];
  if (opts.outcome) {
    conditions.push(eq(schema.apiRequestLogs.outcome, opts.outcome));
  }
  if (opts.pathContains) {
    conditions.push(ilike(schema.apiRequestLogs.path, `%${opts.pathContains}%`));
  }
  if (opts.since) {
    conditions.push(gte(schema.apiRequestLogs.createdAt, opts.since));
  }
  if (opts.until) {
    conditions.push(lt(schema.apiRequestLogs.createdAt, opts.until));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.apiRequestLogs)
    .where(where);

  const rows = await db
    .select()
    .from(schema.apiRequestLogs)
    .where(where)
    .orderBy(desc(schema.apiRequestLogs.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);

  return {
    total: countRow?.count ?? 0,
    data: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      outcome: r.outcome,
      method: r.method,
      path: r.path,
      statusCode: r.statusCode,
      ip: r.ip,
      userId: r.userId,
      apiKeyId: r.apiKeyId,
      message: r.message,
      adminKey: r.adminKey,
    })),
  };
}

/** Map HTTP status to a coarse outcome until auth/keys middleware exists. */
export function outcomeFromStatus(status: number): ApiLogOutcome {
  if (status === 401 || status === 403) {
    return status === 401 ? "auth_failure" : "access_violation";
  }
  if (status >= 400) return "api_failure";
  return "success";
}
