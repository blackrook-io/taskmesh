/* eslint-disable react-refresh/only-export-components -- intentional co-exports (helpers/hooks with components) */
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError, apiJson } from "../../api/client";
import { formatEntityRef } from "../../lib/entityRef";
import {
  formatTaskNumber,
  isDeletedTaskState,
  isDependencyBlockingState,
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
  const bodyId = useId();
  const [sectionOpen, setSectionOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moveOffer, setMoveOffer] = useState<{
    dependsOnTaskId: number;
    planId: number;
    label: string;
    message: string;
  } | null>(null);
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
    mutationFn: async (body: { dependsOnTaskId: number; moveInPlanId?: number }) => {
      const res = await apiJson<{ data: DepPayload }>(`/api/v1/tasks/${taskId}/dependencies`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: (data, variables) => {
      setQuery("");
      setOpen(false);
      setError(null);
      setMoveOffer(null);
      qc.setQueryData(depsKey, data);
      invalidate();
      if (variables.moveInPlanId != null) {
        void qc.invalidateQueries({ queryKey: ["plan-board"] });
      }
      // Also refresh activity on the other task when history is viewed later.
      for (const d of data.dependsOn) {
        void qc.invalidateQueries({ queryKey: ["task-activity", d.id] });
      }
    },
    onError: (err: Error, variables) => {
      if (
        variables.moveInPlanId == null &&
        err instanceof ApiRequestError &&
        err.code === "plan_order_conflict" &&
        err.addAndMove
      ) {
        const plan = err.plans?.find((candidate) => candidate.id === err.addAndMove?.planId);
        setMoveOffer({
          dependsOnTaskId: variables.dependsOnTaskId,
          planId: err.addAndMove.planId,
          label: plan ? formatEntityRef("plan", plan.number) : `plan ${err.addAndMove.planId}`,
          message: err.message,
        });
        setError(err.message);
        return;
      }
      setMoveOffer(null);
      setError(err.message);
    },
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
    onSuccess: (_data, variables) => {
      setError(null);
      invalidate();
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["task-activity", variables.dependentId] });
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
  ) => {
    const deleted = isDeletedTaskState(row.state);
    return (
    <li
      key={`${side}-${row.id}`}
      className={`task-dep-list__row${deleted ? " task-dep-list__row--deleted" : ""}`}
      onDoubleClick={() => onOpenTask?.(row.id)}
      title={onOpenTask ? "Double-click to open" : undefined}
    >
      <span className={`task-dep-list__num${deleted ? "" : " muted"}`}>
        {deleted ? (
          <span className="task-ref__gone" aria-label="Deleted">
            [X]
          </span>
        ) : null}
        {deleted ? " " : null}
        {formatTaskNumber(row.number)}
      </span>
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
  };

  const depCount = dependsOn.length + requiredBy.length;

  return (
    <div
      className={`task-dep-lists${sectionOpen ? "" : " task-dep-lists--collapsed"}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="editor-collapse"
        aria-expanded={sectionOpen}
        aria-controls={bodyId}
        onClick={() => setSectionOpen((open) => !open)}
      >
        <span className="editor-collapse__chevron" aria-hidden>
          {sectionOpen ? "▾" : "▸"}
        </span>
        <span className="editor-collapse__label">Depends on / Required by</span>
        <span className="editor-collapse__count muted">{depsQuery.isLoading ? "…" : depCount}</span>
      </button>
      <div id={bodyId} hidden={!sectionOpen}>
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
                setMoveOffer(null);
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
                        onClick={() => add.mutate({ dependsOnTaskId: s.id })}
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
      </div>

      {error ? (
        <p role="alert" className="tag-input__error">
          {error}
        </p>
      ) : null}
      {moveOffer ? (
        <button
          type="button"
          className="btn small"
          disabled={add.isPending}
          onClick={() =>
            add.mutate({ dependsOnTaskId: moveOffer.dependsOnTaskId, moveInPlanId: moveOffer.planId })
          }
        >
          Add and move in {moveOffer.label}
        </button>
      ) : null}
    </div>
  );
}

/** Fetch open Depends-on blockers for Complete gate (client-side pre-check). */
export async function fetchOpenDependsOn(taskId: number): Promise<TaskDepSummary[]> {
  const res = await apiJson<{ data: DepPayload }>(`/api/v1/tasks/${taskId}/dependencies`);
  return res.data.dependsOn.filter((d) => isDependencyBlockingState(d.state));
}

export function formatCompleteBlockMessage(blockers: TaskDepSummary[]): string {
  const list = blockers
    .map((b) => `${formatTaskNumber(b.number)} (${TASK_STATE_LABELS[b.state as TaskState] ?? b.state})`)
    .join(", ");
  return `Cannot mark Complete while dependencies are still open: ${list}`;
}
