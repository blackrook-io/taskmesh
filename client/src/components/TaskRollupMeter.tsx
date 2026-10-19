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
}: {
  done: number;
  total: number;
  /** False when a parent control already names the fraction. */
  labelled?: boolean;
}) {
  const pct = total <= 0 ? 0 : Math.round((done / total) * 100);
  const band = todoProgressBand(pct);
  const label = `${done} of ${total} complete`;
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
