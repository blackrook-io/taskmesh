import { useCallback, useState } from "react";
import {
  loadRecordListSort,
  saveRecordListSort,
  type RecordListSort,
} from "./recordListSort";

export function usePersistedRecordListSort(storageKey: string, fallback: RecordListSort) {
  const [sort, setSortState] = useState<RecordListSort>(() => loadRecordListSort(storageKey, fallback));
  const [prevKey, setPrevKey] = useState(storageKey);
  const [prevFallback, setPrevFallback] = useState(fallback);
  if (prevKey !== storageKey || prevFallback !== fallback) {
    setPrevKey(storageKey);
    setPrevFallback(fallback);
    setSortState(loadRecordListSort(storageKey, fallback));
  }

  const setSort = useCallback(
    (next: RecordListSort | ((prev: RecordListSort) => RecordListSort)) => {
      setSortState((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        saveRecordListSort(storageKey, value, fallback);
        return value;
      });
    },
    [storageKey, fallback],
  );

  return {
    sortCol: sort.col,
    sortDir: sort.dir,
    setSort,
  };
}
