import { useCallback, useState } from "react";
import {
  loadTaskListSort,
  saveTaskListSort,
  type TaskListSort,
} from "../lib/taskListSort";

export function usePersistedTaskListSort(storageKey: string, fallback: TaskListSort) {
  const [sort, setSortState] = useState<TaskListSort>(() => loadTaskListSort(storageKey, fallback));
  const [prevKey, setPrevKey] = useState(storageKey);
  const [prevFallback, setPrevFallback] = useState(fallback);
  if (prevKey !== storageKey || prevFallback !== fallback) {
    setPrevKey(storageKey);
    setPrevFallback(fallback);
    setSortState(loadTaskListSort(storageKey, fallback));
  }

  const setSort = useCallback(
    (next: TaskListSort | ((prev: TaskListSort) => TaskListSort)) => {
      setSortState((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        saveTaskListSort(storageKey, value, fallback);
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
