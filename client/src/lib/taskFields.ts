/** Client-side helpers for task display fields. */

import { isDependencySatisfied } from "./dependencySatisfied.ts";

export const TASK_STATES = [
  "new",
  "blocked",
  "ready",
  "in_progress",
  "pending",
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
  "pending",
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
  blocked: "Blocked",
  ready: "Ready",
  in_progress: "In Progress",
  pending: "Pending",
  complete: "Complete",
  canceled: "Canceled",
  on_hold: "On Hold",
  deleted: "Deleted",
};

export function isDeletedTaskState(state: string): boolean {
  return state === "deleted";
}

export function isFinishedChildState(state: string): boolean {
  return state === "complete" || state === "canceled" || state === "deleted";
}

/** Open Depends-on / Required-by blockers (Pending does not block). */
export function isDependencyBlockingState(state: string): boolean {
  return !isDependencySatisfied(state);
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

/** Preference when several next states are allowed. Ready follows On Hold so an In Progress click still advances. */
export const TASK_NEXT_STATE_ORDER: TaskState[] = [
  "new",
  "in_progress",
  "on_hold",
  "ready",
  "complete",
  "canceled",
];

/** Task list filter values. Includes Blocked, which users cannot set by hand. */
export const TASK_FILTER_STATES: TaskState[] = [
  "new",
  "blocked",
  "ready",
  "in_progress",
  "pending",
  "complete",
  "canceled",
  "on_hold",
];

/** Parent status computed from descendant leaves (T0335). */
export function isDerivedTaskStatus(task: {
  stateManual?: boolean;
  rollupTotal?: number | null;
}): boolean {
  return task.stateManual !== true && task.rollupTotal != null;
}

export function isClosedTaskState(state: string): boolean {
  return state === "complete" || state === "canceled" || state === "deleted";
}

export function allowedTaskStates(allowed: readonly string[] | undefined): TaskState[] {
  const set = new Set(allowed ?? []);
  return TASK_NEXT_STATE_ORDER.filter((state) => set.has(state));
}

export function nextAllowedTaskState(allowed: readonly string[] | undefined): TaskState | null {
  return allowedTaskStates(allowed)[0] ?? null;
}

export function stateChangeNeedsComment(from: string, to: string): boolean {
  if (to === "canceled") return true;
  return to === "ready" && (from === "complete" || from === "canceled" || from === "in_progress");
}

export function stateReasonPrompt(
  from: string,
  to: string,
): { title: string; message: string; confirmLabel: string } {
  if (to === "canceled") {
    return {
      title: "Cancel task",
      message: "Add a comment explaining why this task is canceled.",
      confirmLabel: "Cancel task",
    };
  }
  if (from === "in_progress" && to === "ready") {
    return {
      title: "Return to Ready",
      message: "Add a comment explaining why this work is stopping.",
      confirmLabel: "Return to Ready",
    };
  }
  return {
    title: "Reopen task",
    message: "Add a comment explaining why this task is reopened.",
    confirmLabel: "Reopen",
  };
}

export function formatTaskNumber(n: number): string {
  return `T${String(n).padStart(4, "0")}`;
}

/** CSS modifier shared by the plan-board checkbox and list State labels. */
export type TaskStateTone =
  | "draft"
  | "blocked"
  | "ready"
  | "progress"
  | "pending"
  | "done"
  | "canceled"
  | "hold"
  | "deleted";

export function taskStateTone(state: TaskState): TaskStateTone {
  switch (state) {
    case "blocked":
      return "blocked";
    case "ready":
      return "ready";
    case "in_progress":
      return "progress";
    case "pending":
      return "pending";
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

export const TASK_STATE_SORT_RANK: Record<TaskState, number> = {
  new: 0,
  blocked: 1,
  ready: 2,
  in_progress: 3,
  pending: 4,
  on_hold: 5,
  complete: 6,
  canceled: 7,
  deleted: 8,
};

export function taskPriorityTone(priority: TaskPriority): TaskPriorityTone {
  return priority;
}

/** e.g. `task-list-row__priority task-list-row__priority--urgent` (no modifier for `none`). */
export function taskPriorityClass(base: string, priority: TaskPriority): string {
  const tone = taskPriorityTone(priority);
  return tone === "none" ? base : `${base} ${base}--${tone}`;
}
