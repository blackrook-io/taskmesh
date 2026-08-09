import { apiJson } from "../api/client";

export type TaskEditSessionBaseline = {
  title: string;
  description: string | null;
  state: string;
  priority: string;
  dueDate: string | null;
  color: string | null;
  phaseId: number | null;
  parentId: number | null;
  projectId: number | null;
};

/** Open modal sessions: baseline preserved across remounts so History stays one line. */
const baselines = new Map<number, TaskEditSessionBaseline>();
const inFlight = new Map<number, Promise<void>>();

/** Start (or keep) an edit session for this task. Remounts do not reset the baseline. */
export function ensureTaskEditSession(
  taskId: number,
  baseline: TaskEditSessionBaseline,
): void {
  if (!baselines.has(taskId)) {
    baselines.set(taskId, baseline);
  }
}

/** True while the task editor session is open (before History flush). */
export function hasTaskEditSession(taskId: number): boolean {
  return baselines.has(taskId);
}

/**
 * Diff open-baseline → current server row and write one History summary.
 * Safe to call multiple times (Close + unmount); only one summary is written.
 */
export async function flushTaskEditSession(taskId: number): Promise<void> {
  const existing = inFlight.get(taskId);
  if (existing) {
    await existing;
    return;
  }

  const before = baselines.get(taskId);
  if (!before) return;

  const run = (async () => {
    try {
      await apiJson(`/api/v1/tasks/${taskId}/activity/session`, {
        method: "POST",
        body: JSON.stringify({ before }),
      });
      baselines.delete(taskId);
    } catch (err) {
      // Keep baseline so a later Close/unmount can retry.
      throw err;
    }
  })();

  inFlight.set(taskId, run);
  try {
    await run;
  } finally {
    inFlight.delete(taskId);
  }
}

/** Drop a session without writing History (e.g. task deleted). */
export function discardTaskEditSession(taskId: number): void {
  baselines.delete(taskId);
}
