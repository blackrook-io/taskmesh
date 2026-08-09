import { useCallback, useEffect, useState } from "react";
import {
  emptyTaskListFilter,
  isFilterActive,
  loadTaskListFilter,
  saveTaskListFilter,
  type TaskListFilter,
} from "../lib/taskListFilter";

export function usePersistedTaskListFilter(storageKey: string) {
  const [filter, setFilter] = useState<TaskListFilter>(() => loadTaskListFilter(storageKey));

  useEffect(() => {
    setFilter(loadTaskListFilter(storageKey));
  }, [storageKey]);

  const applyFilter = useCallback(
    (next: TaskListFilter) => {
      setFilter(next);
      saveTaskListFilter(storageKey, next);
    },
    [storageKey],
  );

  const clearFilter = useCallback(() => {
    const empty = emptyTaskListFilter();
    setFilter(empty);
    saveTaskListFilter(storageKey, empty);
  }, [storageKey]);

  return {
    filter,
    applyFilter,
    clearFilter,
    active: isFilterActive(filter),
  };
}
