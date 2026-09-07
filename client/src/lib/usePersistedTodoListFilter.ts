import { useCallback, useState } from "react";
import {
  emptyTodoListFilter,
  isTodoFilterActive,
  loadTodoListFilter,
  saveTodoListFilter,
  type TodoListFilter,
} from "./todoListFilter";

export function usePersistedTodoListFilter(storageKey: string) {
  const [filter, setFilter] = useState<TodoListFilter>(() => loadTodoListFilter(storageKey));
  const [prevKey, setPrevKey] = useState(storageKey);
  if (prevKey !== storageKey) {
    setPrevKey(storageKey);
    setFilter(loadTodoListFilter(storageKey));
  }

  const applyFilter = useCallback(
    (next: TodoListFilter) => {
      setFilter(next);
      saveTodoListFilter(storageKey, next);
    },
    [storageKey],
  );

  const clearFilter = useCallback(() => {
    const empty = emptyTodoListFilter();
    setFilter(empty);
    saveTodoListFilter(storageKey, empty);
  }, [storageKey]);

  return {
    filter,
    applyFilter,
    clearFilter,
    active: isTodoFilterActive(filter),
  };
}
