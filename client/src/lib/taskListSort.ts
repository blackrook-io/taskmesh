/** Client-side column sort prefs for task list views (localStorage). */

export const TASK_LIST_SORT_COLS = [
  "number",
  "title",
  "state",
  "priority",
  "dueDate",
  "project",
] as const;

export type TaskListSortCol = (typeof TASK_LIST_SORT_COLS)[number];

export type TaskListSort = {
  col: TaskListSortCol | null;
  dir: 1 | -1;
};

/** Project Tasks board: unsorted = manual DnD / sort_order. */
export const DEFAULT_PROJECT_TASK_LIST_SORT: TaskListSort = { col: null, dir: 1 };

/** Global Tasks list default. */
export const DEFAULT_GLOBAL_TASK_LIST_SORT: TaskListSort = { col: "number", dir: 1 };

const COL_SET = new Set<string>(TASK_LIST_SORT_COLS);

export function storageKeyForProjectTaskSort(projectId: number): string {
  return `taskmesh.taskListSort.project:${projectId}`;
}

export function storageKeyForGlobalTaskSort(scope: "all" | "unassigned"): string {
  return scope === "unassigned"
    ? "taskmesh.taskListSort.global:unassigned"
    : "taskmesh.taskListSort.global";
}

export function isSameTaskListSort(a: TaskListSort, b: TaskListSort): boolean {
  return a.col === b.col && a.dir === b.dir;
}

export function parseStoredTaskListSort(raw: string | null): TaskListSort | null {
  if (raw == null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const col =
    obj.col === null ? null : typeof obj.col === "string" && COL_SET.has(obj.col) ? (obj.col as TaskListSortCol) : undefined;
  if (col === undefined) return null;
  const dir = obj.dir === 1 || obj.dir === -1 ? obj.dir : null;
  if (dir == null) return null;
  return { col, dir };
}

export function loadTaskListSort(storageKey: string, fallback: TaskListSort): TaskListSort {
  try {
    const parsed = parseStoredTaskListSort(localStorage.getItem(storageKey));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveTaskListSort(
  storageKey: string,
  sort: TaskListSort,
  fallback: TaskListSort,
): void {
  try {
    if (isSameTaskListSort(sort, fallback)) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(sort));
  } catch {
    /* ignore quota / private mode */
  }
}
