/** Client-side helpers for task display fields. */

export const TASK_STATES = [
  "new",
  "ready",
  "in_progress",
  "complete",
  "canceled",
  "on_hold",
  "deleted",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

/** States shown in dropdowns / filters / cycle (excludes soft-delete). */
export const SELECTABLE_TASK_STATES = [
  "new",
  "ready",
  "in_progress",
  "complete",
  "canceled",
  "on_hold",
] as const;

export type SelectableTaskState = (typeof SELECTABLE_TASK_STATES)[number];

export const TASK_PRIORITIES = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  new: "Draft",
  ready: "Ready",
  in_progress: "In Progress",
  complete: "Complete",
  canceled: "Canceled",
  on_hold: "On Hold",
  deleted: "Deleted",
};

export function isDeletedTaskState(state: string): boolean {
  return state === "deleted";
}

export function isSelectableTaskState(state: string): state is SelectableTaskState {
  return (SELECTABLE_TASK_STATES as readonly string[]).includes(state);
}

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/** Checkbox cycle order matching feature_list. */
export const TASK_STATE_CYCLE: TaskState[] = [
  "new",
  "ready",
  "in_progress",
  "complete",
  "canceled",
  "on_hold",
];

export function nextTaskState(current: TaskState): TaskState {
  const i = TASK_STATE_CYCLE.indexOf(current);
  return TASK_STATE_CYCLE[(i + 1) % TASK_STATE_CYCLE.length] ?? "new";
}

export function formatTaskNumber(n: number): string {
  return `T${String(n).padStart(4, "0")}`;
}

/** CSS modifier shared by StateCheckbox and list State labels. */
export type TaskStateTone =
  | "draft"
  | "ready"
  | "progress"
  | "done"
  | "canceled"
  | "hold"
  | "deleted";

export function taskStateTone(state: TaskState): TaskStateTone {
  switch (state) {
    case "ready":
      return "ready";
    case "in_progress":
      return "progress";
    case "complete":
      return "done";
    case "canceled":
      return "canceled";
    case "on_hold":
      return "hold";
    case "deleted":
      return "deleted";
    default:
      return "draft";
  }
}

/** e.g. `task-list-row__state task-list-row__state--progress`. */
export function taskStateClass(base: string, state: TaskState): string {
  const tone = taskStateTone(state);
  return `${base} ${base}--${tone}`;
}

/** CSS modifier for list Priority selects. */
export type TaskPriorityTone = "none" | "low" | "medium" | "high" | "urgent";

export function taskPriorityTone(priority: TaskPriority): TaskPriorityTone {
  return priority;
}

/** e.g. `task-list-row__priority task-list-row__priority--urgent` (no modifier for `none`). */
export function taskPriorityClass(base: string, priority: TaskPriority): string {
  const tone = taskPriorityTone(priority);
  return tone === "none" ? base : `${base} ${base}--${tone}`;
}
