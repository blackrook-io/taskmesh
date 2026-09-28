/** Manual order vs column sort for reusable record lists (localStorage). */

export type RecordListSort = {
  col: string | null;
  dir: 1 | -1;
};

/** No column sort — display follows persisted manual order. */
export const MANUAL_RECORD_LIST_SORT: RecordListSort = { col: null, dir: 1 };

export function storageKeyForTodoListSort(listId: number): string {
  return `taskmesh.todoListSort.list:${listId}`;
}

export const IDEAS_LIST_SORT_STORAGE_KEY = "taskmesh.ideasListSort";

export function isSameRecordListSort(a: RecordListSort, b: RecordListSort): boolean {
  return a.col === b.col && a.dir === b.dir;
}

/**
 * First click sorts ascending, second descending, third returns to manual order.
 */
export function cycleRecordListSort(current: RecordListSort, fieldKey: string): RecordListSort {
  if (current.col !== fieldKey) return { col: fieldKey, dir: 1 };
  if (current.dir === 1) return { col: fieldKey, dir: -1 };
  return MANUAL_RECORD_LIST_SORT;
}

export function parseStoredRecordListSort(raw: string | null): RecordListSort | null {
  if (raw == null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const col = obj.col === null ? null : typeof obj.col === "string" && obj.col.length > 0 ? obj.col : undefined;
  if (col === undefined) return null;
  const dir = obj.dir === 1 || obj.dir === -1 ? obj.dir : null;
  if (dir == null) return null;
  return { col, dir };
}

export function loadRecordListSort(storageKey: string, fallback: RecordListSort): RecordListSort {
  try {
    const parsed = parseStoredRecordListSort(localStorage.getItem(storageKey));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveRecordListSort(storageKey: string, sort: RecordListSort, fallback: RecordListSort): void {
  try {
    if (isSameRecordListSort(sort, fallback)) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(sort));
  } catch {
    /* ignore quota / private mode */
  }
}
