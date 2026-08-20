import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { ilikeEscaped } from "../lib/ilike.js";
import { formatUserNumber } from "../lib/userFields.js";

type Db = NodePgDatabase<typeof schema>;

export type ApiLogOutcome =
  | "success"
  | "api_failure"
  | "auth_failure"
  | "access_violation";

export type ApiLogLevel = "info" | "warn" | "error";

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

const LEVEL_OUTCOMES: Record<ApiLogLevel, ApiLogOutcome[]> = {
  info: ["success"],
  warn: ["api_failure"],
  error: ["auth_failure", "access_violation"],
};

export function levelFromOutcome(outcome: string): ApiLogLevel {
  if (outcome === "api_failure") return "warn";
  if (outcome === "auth_failure" || outcome === "access_violation") return "error";
  return "info";
}

export function outcomesForLevel(level: ApiLogLevel): ApiLogOutcome[] {
  return LEVEL_OUTCOMES[level];
}

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

/** Fire-and-forget system/audit row (non-HTTP or CLI). */
export function recordSystemLog(
  db: Db,
  input: Omit<ApiRequestLogInput, "method"> & { method?: string },
): void {
  void insertApiRequestLog(db, {
    ...input,
    method: input.method ?? "SYSTEM",
  }).catch((err) => {
    console.error("system_log insert failed", err);
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

export type ApiLogActor = {
  id: number;
  referenceId: string;
  displayName: string;
};

export type ApiLogListItem = {
  id: number;
  createdAt: string;
  outcome: string;
  level: ApiLogLevel;
  success: boolean;
  method: string;
  path: string;
  statusCode: number;
  ip: string | null;
  userId: number | null;
  apiKeyId: number | null;
  message: string | null;
  adminKey: boolean;
  actor: ApiLogActor | null;
  apiKeyOwner: ApiLogActor | null;
  apiKeyPrefix: string | null;
};

export async function listApiRequestLogs(
  db: Db,
  opts: {
    limit: number;
    offset: number;
    outcome?: ApiLogOutcome;
    level?: ApiLogLevel;
    pathContains?: string;
    q?: string;
    since?: Date;
    until?: Date;
  },
): Promise<{ data: ApiLogListItem[]; total: number }> {
  const conditions = [];
  if (opts.outcome) {
    conditions.push(eq(schema.apiRequestLogs.outcome, opts.outcome));
  } else if (opts.level) {
    conditions.push(
      inArray(schema.apiRequestLogs.outcome, outcomesForLevel(opts.level)),
    );
  }
  const search = (opts.q ?? opts.pathContains)?.trim();
  if (search) {
    conditions.push(
      or(
        ilikeEscaped(schema.apiRequestLogs.path, search),
        ilikeEscaped(schema.apiRequestLogs.message, search),
      )!,
    );
  }
  if (opts.since) {
    conditions.push(gte(schema.apiRequestLogs.createdAt, opts.since));
  }
  if (opts.until) {
    conditions.push(lt(schema.apiRequestLogs.createdAt, opts.until));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const actorUser = schema.users;
  // Alias owner via second join on api_keys.user_id
  const keyOwner = schema.users;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.apiRequestLogs)
    .where(where);

  const rows = await db
    .select({
      log: schema.apiRequestLogs,
      actorNumber: actorUser.number,
      actorDisplayName: actorUser.displayName,
      apiKeyPrefix: schema.apiKeys.prefix,
      keyOwnerId: schema.apiKeys.userId,
    })
    .from(schema.apiRequestLogs)
    .leftJoin(actorUser, eq(schema.apiRequestLogs.userId, actorUser.id))
    .leftJoin(schema.apiKeys, eq(schema.apiRequestLogs.apiKeyId, schema.apiKeys.id))
    .where(where)
    .orderBy(desc(schema.apiRequestLogs.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);

  // Resolve key owners in a second query when needed (avoids ambiguous dual users join).
  const ownerIds = [
    ...new Set(
      rows
        .map((r) => r.keyOwnerId)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];
  const ownerById = new Map<number, ApiLogActor>();
  if (ownerIds.length > 0) {
    const owners = await db
      .select({
        id: keyOwner.id,
        number: keyOwner.number,
        displayName: keyOwner.displayName,
      })
      .from(keyOwner)
      .where(inArray(keyOwner.id, ownerIds));
    for (const o of owners) {
      ownerById.set(o.id, {
        id: o.id,
        referenceId: formatUserNumber(o.number),
        displayName: o.displayName,
      });
    }
  }

  return {
    total: countRow?.count ?? 0,
    data: rows.map((r) => {
      const outcome = r.log.outcome;
      const actor =
        r.log.userId != null && r.actorNumber != null && r.actorDisplayName != null
          ? {
              id: r.log.userId,
              referenceId: formatUserNumber(r.actorNumber),
              displayName: r.actorDisplayName,
            }
          : null;
      const apiKeyOwner =
        r.keyOwnerId != null ? (ownerById.get(r.keyOwnerId) ?? null) : null;
      return {
        id: r.log.id,
        createdAt: r.log.createdAt.toISOString(),
        outcome,
        level: levelFromOutcome(outcome),
        success: outcome === "success",
        method: r.log.method,
        path: r.log.path,
        statusCode: r.log.statusCode,
        ip: r.log.ip,
        userId: r.log.userId,
        apiKeyId: r.log.apiKeyId,
        message: r.log.message,
        adminKey: r.log.adminKey,
        actor,
        apiKeyOwner,
        apiKeyPrefix: r.apiKeyPrefix ?? null,
      };
    }),
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
