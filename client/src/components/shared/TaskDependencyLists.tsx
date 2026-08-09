import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "../../api/client";
import {
  formatTaskNumber,
  TASK_STATE_LABELS,
  taskStateClass,
  type TaskState,
} from "../../lib/taskFields";

export type TaskDepSummary = {
  id: number;
  number: number;
  title: string;
  state: string;
};

type DepPayload = {
  dependsOn: TaskDepSummary[];
  requiredBy: TaskDepSummary[];
};

type Props = {
  taskId: number;
  /** Open related task in-place (same editor/modal). */
  onOpenTask?: (taskId: number) => void;
};

export function TaskDependencyLists({ taskId, onOpenTask }: Props) {
  const qc = useQueryClient();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const depsKey = ["task-dependencies", taskId] as const;

  const depsQuery = useQuery({
    queryKey: depsKey,
    queryFn: async () => {
      const res = await apiJson<{ data: DepPayload }>(`/api/v1/tasks/${taskId}/dependencies`);
      return res.data;
    },
  });

  const suggestQ = query.trim();
  const suggestQuery = useQuery({
    queryKey: ["task-dependency-search", suggestQ, taskId],
    enabled: suggestQ.length >= 1,
    queryFn: async () => {
      const res = await apiJson<{ data: TaskDepSummary[] }>(
        `/api/v1/tasks/dependency-search?q=${encodeURIComponent(suggestQ)}&excludeTaskId=${taskId}`,
      );
      return res.data;
    },
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: depsKey });
    void qc.invalidateQueries({ queryKey: ["task-activity", taskId] });
    void qc.invalidateQueries({ queryKey: ["task-dependency-search"] });
  };

  const add = useMutation({
    mutationFn: async (dependsOnTaskId: number) => {
      const res = await apiJson<{ data: DepPayload }>(`/api/v1/tasks/${taskId}/dependencies`, {
        method: "POST",
        body: JSON.stringify({ dependsOnTaskId }),
      });
      return res.data;
    },
    onSuccess: (data) => {
      setQuery("");
      setOpen(false);
      setError(null);
      qc.setQueryData(depsKey, data);
      invalidate();
      // Also refresh activity on the other task when history is viewed later.
      for (const d of data.dependsOn) {
        void qc.invalidateQueries({ queryKey: ["task-activity", d.id] });
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: async ({
      dependentId,
      dependsOnTaskId,
    }: {
      dependentId: number;
      dependsOnTaskId: number;
    }) => {
      const res = await apiJson<{ data: DepPayload }>(
        `/api/v1/tasks/${dependentId}/dependencies/${dependsOnTaskId}`,
        { method: "DELETE" },
      );
      return res.data;
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const dependsOn = depsQuery.data?.dependsOn ?? [];
  const requiredBy = depsQuery.data?.requiredBy ?? [];
  const linkedIds = new Set([...dependsOn.map((d) => d.id), taskId]);
  const suggestions = (suggestQuery.data ?? []).filter((t) => !linkedIds.has(t.id));

  const renderRow = (
    row: TaskDepSummary,
    side: "dependsOn" | "requiredBy",
  ) => (
    <li
      key={`${side}-${row.id}`}
      className="task-dep-list__row"
      onDoubleClick={() => onOpenTask?.(row.id)}
      title={onOpenTask ? "Double-click to open" : undefined}
    >
      <span className="task-dep-list__num muted">{formatTaskNumber(row.number)}</span>
      <span className="task-dep-list__title">{row.title}</span>
      <span className={taskStateClass("task-dep-list__state", row.state as TaskState)}>
        {TASK_STATE_LABELS[row.state as TaskState] ?? row.state}
      </span>
      <button
        type="button"
        className="btn small ghost task-dep-list__remove"
        aria-label={`Remove ${formatTaskNumber(row.number)}`}
        disabled={remove.isPending}
        onClick={(e) => {
          e.stopPropagation();
          if (side === "dependsOn") {
            remove.mutate({ dependentId: taskId, dependsOnTaskId: row.id });
          } else {
            remove.mutate({ dependentId: row.id, dependsOnTaskId: taskId });
          }
        }}
      >
        ×
      </button>
    </li>
  );

  return (
    <div className="task-dep-lists" ref={rootRef}>
      <div className="task-dep-lists__columns">
        <div className="task-dep-lists__section">
          <label className="task-dep-lists__label" htmlFor={inputId}>
            Depends on
          </label>
          <ul className="task-dep-list">
            {dependsOn.length === 0 ? (
              <li className="task-dep-list__empty muted">None</li>
            ) : (
              dependsOn.map((r) => renderRow(r, "dependsOn"))
            )}
          </ul>
          <div className="task-dep-lists__add">
            <input
              id={inputId}
              type="text"
              className="task-dep-lists__search"
              placeholder="Add dependency (title or number)…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setError(null);
              }}
              onFocus={() => setOpen(true)}
              disabled={add.isPending}
              autoComplete="off"
            />
            {open && suggestQ.length >= 1 ? (
              <ul className="task-dep-lists__suggest" role="listbox">
                {suggestQuery.isFetching ? (
                  <li className="task-dep-lists__suggest-empty muted">Searching…</li>
                ) : suggestions.length === 0 ? (
                  <li className="task-dep-lists__suggest-empty muted">No matching tasks</li>
                ) : (
                  suggestions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="task-dep-lists__suggest-item"
                        onClick={() => add.mutate(s.id)}
                      >
                        <span className="muted">{formatTaskNumber(s.number)}</span> {s.title}
                        <span className={taskStateClass("task-dep-list__state", s.state as TaskState)}>
                          {TASK_STATE_LABELS[s.state as TaskState] ?? s.state}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="task-dep-lists__section">
          <span className="task-dep-lists__label">Required by</span>
          <ul className="task-dep-list">
            {requiredBy.length === 0 ? (
              <li className="task-dep-list__empty muted">None</li>
            ) : (
              requiredBy.map((r) => renderRow(r, "requiredBy"))
            )}
          </ul>
        </div>
      </div>

      {error ? (
        <p role="alert" className="tag-input__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Fetch open Depends-on blockers for Complete gate (client-side pre-check). */
export async function fetchOpenDependsOn(taskId: number): Promise<TaskDepSummary[]> {
  const res = await apiJson<{ data: DepPayload }>(`/api/v1/tasks/${taskId}/dependencies`);
  return res.data.dependsOn.filter((d) => d.state !== "complete" && d.state !== "canceled");
}

export function formatCompleteBlockMessage(blockers: TaskDepSummary[]): string {
  const list = blockers
    .map((b) => `${formatTaskNumber(b.number)} (${TASK_STATE_LABELS[b.state as TaskState] ?? b.state})`)
    .join(", ");
  return `Cannot mark Complete while dependencies are still open: ${list}`;
}
