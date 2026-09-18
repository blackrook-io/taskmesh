/**
 * Pure Project Overview list selectors (T0135).
 * Kept on the server for unit tests; mirrored in client/src/lib/projectOverview.ts.
 */

export type OverviewDueRecord = {
  id: number;
  state: string;
  dueDate: string | null;
  updatedAt: string;
  sortOrder: number;
};

const ACTIVE_STATES = new Set([
  "new",
  "ready",
  "in_progress",
  "pending",
  "on_hold",
]);

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function localYmd(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const parts = ymd.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return localYmd(dt);
}

function isIncomplete(state: string): boolean {
  return ACTIVE_STATES.has(state);
}

export function selectRecentlyCompleted<T extends OverviewDueRecord>(
  rows: T[],
  limit: number,
  days: number,
  now = new Date(),
): T[] {
  const today = localYmd(now);
  const earliest = addDaysYmd(today, -Math.max(1, days));
  return rows
    .filter((t) => t.state === "complete")
    .filter((t) => {
      const ymd = localYmd(new Date(t.updatedAt));
      return ymd >= earliest && ymd <= today;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export function selectNextDue<T extends OverviewDueRecord>(rows: T[], limit: number): T[] {
  return rows
    .filter((t) => isIncomplete(t.state) && t.dueDate)
    .sort((a, b) => {
      const due = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      if (due !== 0) return due;
      return a.sortOrder - b.sortOrder || a.id - b.id;
    })
    .slice(0, limit);
}

export function selectOverdue<T extends OverviewDueRecord>(
  rows: T[],
  limit: number,
  now = new Date(),
): T[] {
  const today = localYmd(now);
  return rows
    .filter((t) => isIncomplete(t.state) && t.dueDate && t.dueDate < today)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.id - b.id)
    .slice(0, limit);
}

export function selectUpcoming<T extends OverviewDueRecord>(
  rows: T[],
  limit: number,
  days: number,
  now = new Date(),
): T[] {
  const today = localYmd(now);
  const latest = addDaysYmd(today, Math.max(1, days));
  return rows
    .filter(
      (t) =>
        isIncomplete(t.state) &&
        t.dueDate &&
        t.dueDate >= today &&
        t.dueDate <= latest,
    )
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.id - b.id)
    .slice(0, limit);
}
