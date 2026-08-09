/** Persistent prefs for task History timelines. */
export type TaskHistorySortDir = "asc" | "desc";

const SORT_DIR_KEY = "taskmesh.taskHistory.sortDir";
const SHOW_CHANGES_KEY = "taskmesh.taskHistory.showChanges";

export function loadTaskHistorySortDir(): TaskHistorySortDir {
  try {
    const raw = localStorage.getItem(SORT_DIR_KEY);
    if (raw === "asc" || raw === "desc") return raw;
  } catch {
    /* ignore */
  }
  /** Newest first — recent edits sit near the comment composer. */
  return "desc";
}

export function saveTaskHistorySortDir(dir: TaskHistorySortDir): void {
  try {
    localStorage.setItem(SORT_DIR_KEY, dir);
  } catch {
    /* ignore */
  }
}

/** When true, field-change / summary rows are visible; comments always show. */
export function loadTaskHistoryShowChanges(): boolean {
  try {
    const raw = localStorage.getItem(SHOW_CHANGES_KEY);
    if (raw === "0" || raw === "false") return false;
    if (raw === "1" || raw === "true") return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function saveTaskHistoryShowChanges(show: boolean): void {
  try {
    localStorage.setItem(SHOW_CHANGES_KEY, show ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function compareTaskHistoryEntries(
  a: { id: number; createdAt: string },
  b: { id: number; createdAt: string },
  dir: TaskHistorySortDir,
): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  const aOk = Number.isFinite(ta);
  const bOk = Number.isFinite(tb);
  if (aOk && bOk && ta !== tb) {
    return dir === "asc" ? ta - tb : tb - ta;
  }
  if (aOk !== bOk) {
    // Parseable timestamps first when ascending; last when descending.
    if (dir === "asc") return aOk ? -1 : 1;
    return aOk ? 1 : -1;
  }
  return dir === "asc" ? a.id - b.id : b.id - a.id;
}
