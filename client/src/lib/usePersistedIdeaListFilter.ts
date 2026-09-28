import { useCallback, useState } from "react";
import {
  emptyIdeaListFilter,
  isIdeaFilterActive,
  loadIdeaListFilter,
  saveIdeaListFilter,
  type IdeaListFilter,
} from "./ideaListFilter";

export function usePersistedIdeaListFilter(storageKey: string) {
  const [filter, setFilter] = useState<IdeaListFilter>(() => loadIdeaListFilter(storageKey));
  const [prevKey, setPrevKey] = useState(storageKey);
  if (prevKey !== storageKey) {
    setPrevKey(storageKey);
    setFilter(loadIdeaListFilter(storageKey));
  }

  const applyFilter = useCallback(
    (next: IdeaListFilter) => {
      setFilter(next);
      saveIdeaListFilter(storageKey, next);
    },
    [storageKey],
  );

  const clearFilter = useCallback(() => {
    const empty = emptyIdeaListFilter();
    setFilter(empty);
    saveIdeaListFilter(storageKey, empty);
  }, [storageKey]);

  return {
    filter,
    applyFilter,
    clearFilter,
    active: isIdeaFilterActive(filter),
  };
}
