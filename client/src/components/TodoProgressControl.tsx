import { useState } from "react";
import { clampTodoProgress, todoProgressBand } from "../lib/todoProgress";

export function TodoProgressControl({
  progress,
  onCommit,
  label = "Progress",
  readOnly = false,
  caption,
}: {
  progress: number;
  onCommit: (next: number) => void;
  label?: string;
  readOnly?: boolean;
  caption?: string;
}) {
  const [value, setValue] = useState(progress);
  const [synced, setSynced] = useState(progress);
  if (progress !== synced) {
    setSynced(progress);
    setValue(progress);
  }
  const band = todoProgressBand(value);

  const commit = (raw: number) => {
    const next = clampTodoProgress(raw);
    setValue(next);
    if (next !== progress) onCommit(next);
  };

  return (
    <div className={`todo-progress todo-progress--${band}`}>
      <div className="todo-progress__track" aria-hidden>
        <div className="todo-progress__fill" style={{ width: `${value}%` }} />
      </div>
      {readOnly ? null : (
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          aria-label={`${label} ${value}%`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setValue(clampTodoProgress(Number(e.target.value)))}
          onPointerUp={(e) => commit(Number(e.currentTarget.value))}
          onKeyUp={(e) => commit(Number(e.currentTarget.value))}
          onBlur={(e) => commit(Number(e.target.value))}
        />
      )}
      <span className="todo-progress__pct" aria-label={readOnly ? `${label} ${caption ? `${caption}, ` : ""}${value}%` : undefined}>
        {caption ? <span className="todo-progress__count">{caption} </span> : null}
        {value}%
      </span>
    </div>
  );
}
