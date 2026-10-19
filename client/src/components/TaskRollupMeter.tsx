import { rollupMeterTitle, type ClosedHideCounts } from "../lib/hideCompletedTasks";
import { todoProgressBand } from "../lib/todoProgress";

/** `done/total` label shared by the list chevron and the progress meter. */
export function TaskRollupCount({ done, total }: { done: number; total: number }) {
  return (
    <span className="task-rollup__count">
      {done}/{total}
    </span>
  );
}

/** `[done/total]` and a bar for a derived parent row. */
export function TaskRollupMeter({
  done,
  total,
  labelled = true,
  hiddenCompleted = 0,
  hiddenCanceled = 0,
}: {
  done: number;
  total: number;
  /** False when a parent control already names the fraction. */
  labelled?: boolean;
  /** Complete descendants omitted by Hide completed. */
  hiddenCompleted?: number;
  /** Canceled descendants omitted by Hide completed. */
  hiddenCanceled?: number;
}) {
  const pct = total <= 0 ? 0 : Math.round((done / total) * 100);
  const band = todoProgressBand(pct);
  const hidden: ClosedHideCounts | null =
    hiddenCompleted > 0 || hiddenCanceled > 0
      ? { completed: hiddenCompleted, canceled: hiddenCanceled }
      : null;
  const label = rollupMeterTitle(done, total, hidden);
  return (
    <span
      className={`task-rollup todo-progress--${band}`}
      title={label}
      aria-label={labelled ? label : undefined}
    >
      <TaskRollupCount done={done} total={total} />
      <span className="todo-progress__track" aria-hidden>
        <span className="todo-progress__fill" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}
