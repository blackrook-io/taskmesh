import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90;
/** How often to attempt a prune (cheap when nothing is expired). */
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

/** Retention window in days; override with `API_REQUEST_LOG_RETENTION_DAYS`. */
export function apiRequestLogRetentionDays(): number {
  const raw = process.env.API_REQUEST_LOG_RETENTION_DAYS?.trim();
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RETENTION_DAYS;
  return Math.min(Math.floor(n), 3650);
}

export async function pruneApiRequestLogs(
  db: Db,
  retentionDays = apiRequestLogRetentionDays(),
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
  const result = await db.execute(
    sql`delete from api_request_logs where created_at < ${cutoff}`,
  );
  return Number((result as { rowCount?: number | null }).rowCount ?? 0);
}

export function startApiRequestLogPruner(db: Db): void {
  if (schedulerTimer) return;
  const tick = () => {
    void pruneApiRequestLogs(db)
      .then((n) => {
        if (n > 0) {
          console.log(
            `[api_request_logs] pruned ${n} row(s) older than ${apiRequestLogRetentionDays()}d`,
          );
        }
      })
      .catch((err) => {
        console.error("[api_request_logs] prune failed", err);
      });
  };
  schedulerTimer = setInterval(tick, PRUNE_INTERVAL_MS);
  // Delay first prune slightly so boot is not blocked on a large delete.
  setTimeout(tick, 30_000);
}

export function stopApiRequestLogPruner(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
