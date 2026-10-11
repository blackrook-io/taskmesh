export type TaskListStateKind = "group" | "ungrouped" | "parent";

export type TaskListState = {
  collapsedGroupIds: number[];
  collapsedUngroupedProjectIds: number[];
  collapsedParentIds: number[];
};

export const EMPTY_TASK_LIST_STATE: TaskListState = {
  collapsedGroupIds: [],
  collapsedUngroupedProjectIds: [],
  collapsedParentIds: [],
};

function columnForKind(kind: TaskListStateKind): keyof TaskListState {
  if (kind === "group") return "collapsedGroupIds";
  if (kind === "ungrouped") return "collapsedUngroupedProjectIds";
  return "collapsedParentIds";
}

/** Add or remove one id. Returns the same object when nothing changes. */
export function applyTaskListStateToggle(
  state: TaskListState,
  kind: TaskListStateKind,
  id: number,
  collapsed: boolean,
): TaskListState {
  const key = columnForKind(kind);
  const current = state[key];
  const has = current.includes(id);
  if (collapsed === has) return state;
  const nextIds = collapsed ? [...current, id] : current.filter((n) => n !== id);
  return { ...state, [key]: nextIds };
}
