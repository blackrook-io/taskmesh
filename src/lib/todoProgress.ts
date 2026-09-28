/** Stored ToDo percent (T0155) and how it stays aligned with state and list checks. */

export type TodoProgressSnapshot = {
  progress: number;
  state: string;
};

export type TodoProgressPatch = {
  progress?: number;
  state?: string;
};

export type TodoProgressResult = {
  progress: number;
  state: string;
  /** When set, every ToDo list membership should use this checked flag. */
  membershipChecked: boolean | null;
};

/**
 * Apply a progress and/or state patch.
 * 100% or state Complete marks the ToDo complete and checks memberships.
 * Leaving 100% while Complete, or leaving Complete while at 100%, reopens the ToDo and unchecks.
 */
export function resolveTodoProgressUpdate(
  current: TodoProgressSnapshot,
  patch: TodoProgressPatch,
): TodoProgressResult {
  const setProgress = patch.progress !== undefined;
  const setState = patch.state !== undefined;
  let progress = setProgress ? patch.progress! : current.progress;
  let state = setState ? patch.state! : current.state;
  let membershipChecked: boolean | null = null;

  if (setProgress && progress === 100) {
    state = "complete";
    membershipChecked = true;
  } else if (setState && state === "complete") {
    progress = 100;
    membershipChecked = true;
  } else if (setProgress && progress < 100 && current.state === "complete") {
    state = "in_progress";
    membershipChecked = false;
  } else if (setState && state !== "complete" && current.progress === 100) {
    progress = 0;
    membershipChecked = false;
  }

  return { progress, state, membershipChecked };
}

/**
 * List checkbox. Checking always completes at 100%.
 * Unchecking a completed ToDo (100% or state Complete) sets progress to 0 and state to In Progress.
 * Unchecking any other row does not change the ToDo; returns null.
 */
export function resolveTodoCheckToggle(
  checked: boolean,
  current: TodoProgressSnapshot,
): TodoProgressResult | null {
  if (checked) {
    return { progress: 100, state: "complete", membershipChecked: true };
  }
  if (current.progress === 100 || current.state === "complete") {
    return { progress: 0, state: "in_progress", membershipChecked: false };
  }
  return null;
}
