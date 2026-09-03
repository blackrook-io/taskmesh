import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../api/client";
import { formatTaskNumber, TASK_STATE_LABELS, taskStateClass } from "../lib/taskFields";
import type { TaskDepSummary } from "./shared/TaskDependencyLists";

type Props = {
  open: boolean;
  taskId: number;
  currentParentId: number | null;
  onClose: () => void;
  onSave: (parentId: number | null) => Promise<void>;
};

function taskLabel(t: Pick<TaskDepSummary, "number" | "title">): string {
  return `${formatTaskNumber(t.number)} ${t.title}`;
}

/** Draft parent to save: pick a task, clear parent, or still searching. */
type Draft =
  | { mode: "search"; query: string }
  | { mode: "picked"; task: TaskDepSummary }
  | { mode: "clear" };

export function SetTaskParentModal({
  open,
  taskId,
  currentParentId,
  onClose,
  onSave,
}: Props) {
  const titleId = useId();
  const [draft, setDraft] = useState<Draft>({ mode: "search", query: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft({ mode: "search", query: "" });
    setError(null);
    setBusy(false);
  }, [open, currentParentId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const suggestQ = draft.mode === "search" ? draft.query.trim() : "";
  const suggestQuery = useQuery({
    queryKey: ["task-parent-search", suggestQ, taskId],
    enabled: open && draft.mode === "search" && suggestQ.length >= 1,
    queryFn: async () => {
      const res = await apiJson<{ data: TaskDepSummary[] }>(
        `/api/v1/tasks/dependency-search?q=${encodeURIComponent(suggestQ)}&excludeTaskId=${taskId}`,
      );
      return res.data;
    },
  });

  if (!open) return null;

  const results = suggestQuery.data ?? [];
  const nextParentId =
    draft.mode === "picked" ? draft.task.id : draft.mode === "clear" ? null : undefined;
  const canSave =
    nextParentId !== undefined && nextParentId !== currentParentId && !busy;

  const inputValue =
    draft.mode === "picked"
      ? taskLabel(draft.task)
      : draft.mode === "clear"
        ? ""
        : draft.query;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Set parent task</h2>
        <label className="stack-field">
          <span className="muted">Search tasks</span>
          <input
            type="search"
            value={inputValue}
            onChange={(e) => setDraft({ mode: "search", query: e.target.value })}
            placeholder="Title or T####"
            autoFocus
            aria-autocomplete="list"
            aria-expanded={draft.mode === "search" && suggestQ.length >= 1}
          />
        </label>
        {draft.mode === "picked" ? (
          <p className="task-picker-selected" role="status">
            Selected: <strong>{taskLabel(draft.task)}</strong>
          </p>
        ) : draft.mode === "clear" ? (
          <p className="task-picker-selected muted" role="status">
            Parent will be cleared on Save.
          </p>
        ) : null}
        <ul className="task-picker-list" role="listbox" aria-label="Parent candidates">
          {draft.mode === "picked" || draft.mode === "clear" ? (
            <li className="muted task-picker-list__hint">
              Edit the search field to choose a different parent.
            </li>
          ) : suggestQ.length < 1 ? (
            <li className="muted task-picker-list__hint">Type to search…</li>
          ) : suggestQuery.isFetching ? (
            <li className="muted task-picker-list__hint">Searching…</li>
          ) : results.length === 0 ? (
            <li className="muted task-picker-list__hint">No matches</li>
          ) : (
            results.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="task-picker-list__btn"
                  role="option"
                  onClick={() => setDraft({ mode: "picked", task: t })}
                >
                  <span className="muted">{formatTaskNumber(t.number)}</span> {t.title}{" "}
                  <span className={taskStateClass("task-picker-list__state", t.state as never)}>
                    {TASK_STATE_LABELS[t.state as keyof typeof TASK_STATE_LABELS] ?? t.state}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        {error ? (
          <p className="confirm-dialog__warning" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button
            type="button"
            className="btn ghost"
            disabled={busy || (currentParentId == null && draft.mode !== "picked")}
            onClick={() => setDraft({ mode: "clear" })}
            title="Clear parent on Save"
          >
            Clear parent
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canSave}
            onClick={() => {
              if (nextParentId === undefined) return;
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  await onSave(nextParentId);
                  onClose();
                } catch (err) {
                  setError((err as Error).message);
                  setBusy(false);
                }
              })();
            }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
