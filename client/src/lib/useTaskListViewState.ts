import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiJson } from "../api/client";
import {
  applyTaskListStateToggle,
  EMPTY_TASK_LIST_STATE,
  type TaskListState,
  type TaskListStateKind,
} from "./taskListState";

export const TASK_LIST_STATE_KEY = ["task-list-state"] as const;

type ToggleInput = {
  kind: TaskListStateKind;
  id: number;
  collapsed: boolean;
};

/** Ignore an older PATCH response after a newer toggle already updated the cache. */
let toggleRevision = 0;

export function useTaskListViewState() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: TASK_LIST_STATE_KEY,
    queryFn: async ({ signal }) => {
      const res = await apiJson<{ data: TaskListState }>("/api/v1/users/me/task-list-state", {
        signal,
      });
      return res.data;
    },
    staleTime: 60_000,
  });

  const state = query.data ?? EMPTY_TASK_LIST_STATE;

  const collapsedGroupIds = state.collapsedGroupIds;
  const collapsedUngroupedProjectIds = state.collapsedUngroupedProjectIds;
  const collapsedParentIds = state.collapsedParentIds;

  const collapsedParents = useMemo(() => new Set(collapsedParentIds), [collapsedParentIds]);

  const toggle = useMutation({
    mutationFn: async (input: ToggleInput) => {
      const res = await apiJson<{ data: TaskListState }>("/api/v1/users/me/task-list-state", {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      return res.data;
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: TASK_LIST_STATE_KEY });
      const previous =
        qc.getQueryData<TaskListState>(TASK_LIST_STATE_KEY) ?? EMPTY_TASK_LIST_STATE;
      const next = applyTaskListStateToggle(previous, input.kind, input.id, input.collapsed);
      qc.setQueryData(TASK_LIST_STATE_KEY, next);
      toggleRevision += 1;
      return { revision: toggleRevision, previous };
    },
    onSuccess: (data, _input, ctx) => {
      if (ctx?.revision === toggleRevision) {
        qc.setQueryData(TASK_LIST_STATE_KEY, data);
      }
    },
    onError: (_err, _input, ctx) => {
      if (ctx && ctx.revision === toggleRevision) {
        qc.setQueryData(TASK_LIST_STATE_KEY, ctx.previous);
      } else {
        void qc.invalidateQueries({ queryKey: TASK_LIST_STATE_KEY });
      }
    },
  });

  return {
    collapsedGroupIds,
    collapsedUngroupedProjectIds,
    collapsedParents,
    isLoading: query.isLoading,
    toggle: toggle.mutate,
  };
}
