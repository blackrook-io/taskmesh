/** Client-side helpers for task display fields. */

export const TASK_STATES = [
  "new",
  "in_progress",
  "complete",
  "canceled",
  "on_hold",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const TASK_PRIORITIES = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  new: "New",
  in_progress: "In Progress",
  complete: "Complete",
  canceled: "Canceled",
  on_hold: "On Hold",
};

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
