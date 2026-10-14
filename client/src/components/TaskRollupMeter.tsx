import { todoProgressBand } from "../lib/todoProgress";

/** `[done/total]` and a bar for a derived parent row. */
export function TaskRollupMeter({ done, total }: { done: number; total: number }) {
  const pct = total <= 0 ? 0 : Math.round((done / total) * 100);
  const band = todoProgressBand(pct);
  const label = `${done} of ${total} complete`;
  return (
    <span className={`task-rollup todo-progress--${band}`} title={label} aria-label={label}>
      <span className="task-rollup__count">
        {done}/{total}
      </span>
      <span className="todo-progress__track" aria-hidden>
        <span className="todo-progress__fill" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}
