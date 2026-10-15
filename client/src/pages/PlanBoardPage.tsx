import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiRequestError, apiJson } from "../api/client";
import { StateReasonDialog } from "../components/StateReasonDialog";
import { HoursInput } from "../components/shared/HoursInput";
import { useAuth } from "../lib/auth";
import { formatEntityRef } from "../lib/entityRef";
import { patchTaskRecord } from "../lib/patchTask";
import {
  planBlockerLabel,
  planCheckboxChecked,
  planCheckAction,
  planHoursSummary,
  planIndentDepth,
  planItemRef,
  planPhaseAccent,
  planPhaseCollapseKey,
  planProgressPercent,
  planRowHours,
  planUnestimatedLabel,
  readCollapsedPhaseIds,
  type PlanBoard,
  type PlanBoardItem,
  type PlanBoardPhase,
  type PlanRollupSlice,
} from "../lib/planBoard";
import { TASK_STATE_LABELS, taskStateClass, type TaskState } from "../lib/taskFields";

function isTaskState(state: string): state is TaskState {
  return Object.prototype.hasOwnProperty.call(TASK_STATE_LABELS, state);
}

function stateLabel(state: string): string {
  return isTaskState(state) ? TASK_STATE_LABELS[state] : state;
}

function dueLabel(value: string | null): string {
  if (!value) return "—";
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "—";
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function hoursText(hours: number | null): string {
  return hours == null ? "— h" : `${hours} h`;
}

function ProgressMeter({ rollup, label }: { rollup: PlanRollupSlice; label: string }) {
  const percent = planProgressPercent(rollup.progress);
  return (
    <div className="plan-board__meter">
      <div
        className="plan-board__meter-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={label}
      >
        <span className="plan-board__meter-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="plan-board__meter-label">
        {percent}%{rollup.progressMode === "count" ? " by item count" : ""}
      </span>
    </div>
  );
}

function RollupSummary({ rollup }: { rollup: PlanRollupSlice }) {
  const unestimated = planUnestimatedLabel(rollup.unestimatedCount);
  return (
    <div className="plan-board__summary">
      <p className="plan-board__hours-total">{planHoursSummary(rollup.hoursDone, rollup.hoursTotal)}</p>
      <ProgressMeter rollup={rollup} label="Plan progress" />
      <p className="muted plan-board__counts">
        {rollup.itemsDone} of {rollup.itemCount} done
      </p>
      {unestimated ? <p className="plan-board__warn">{unestimated}</p> : null}
    </div>
  );
}

type CheckProps = {
  item: PlanBoardItem;
  pending: boolean;
  onComplete: () => void;
  onStart: () => void;
  onStartAndComplete: () => void;
  onUncheck: () => void;
};

function PlanCheckControl({
  item,
  pending,
  onComplete,
  onStart,
  onStartAndComplete,
  onUncheck,
}: CheckProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const action = planCheckAction(item);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const ref = planItemRef(item);
  const checked = planCheckboxChecked(item);
  const className = isTaskState(item.state)
    ? taskStateClass("task-state-cb", item.state)
    : "task-state-cb";
  const mark = checked ? "✓" : "";

  if (action.kind === "ready-menu") {
    const blocker = planBlockerLabel(action.blockers);
    return (
      <div className="plan-board__menu" ref={menuRef}>
        <button
          type="button"
          className={className}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Actions for ${ref}`}
          disabled={pending}
          onClick={() => setOpen((value) => !value)}
        >
          {mark}
        </button>
        {open ? (
          <div className="plan-board__menu-panel" role="menu">
            {blocker ? <p className="plan-board__menu-note">{blocker}</p> : null}
            <button
              type="button"
              role="menuitem"
              className="plan-board__menu-item"
              onClick={() => {
                setOpen(false);
                onStart();
              }}
            >
              Start
            </button>
            {action.startAndComplete ? (
              <button
                type="button"
                role="menuitem"
                className="plan-board__menu-item"
                onClick={() => {
                  setOpen(false);
                  onStartAndComplete();
                }}
              >
                Start and complete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const label =
    action.kind === "complete"
      ? `Mark ${ref} complete`
      : action.kind === "uncheck"
        ? `Reopen ${ref}`
        : `${ref} has no check action`;

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      disabled={action.kind === "disabled" || pending}
      onClick={() => {
        if (action.kind === "complete") onComplete();
        if (action.kind === "uncheck") onUncheck();
      }}
    >
      {mark}
    </button>
  );
}

function PlanRow({
  item,
  items,
  canWriteItems,
  pending,
  onComplete,
  onStart,
  onStartAndComplete,
  onUncheck,
  onHours,
}: {
  item: PlanBoardItem;
  items: PlanBoardItem[];
  canWriteItems: boolean;
  pending: boolean;
  onComplete: () => void;
  onStart: () => void;
  onStartAndComplete: () => void;
  onUncheck: () => void;
  onHours: (hours: number | null) => void;
}) {
  const depth = planIndentDepth(items, item);
  const hours = planRowHours(items, item);
  const blocker = planBlockerLabel(item.actions.blockedBy);
  const ref = planItemRef(item);
  const editable = canWriteItems && hours.editable;
  return (
    <div className="plan-board__row" role="row">
      <span className="plan-board__handle" aria-hidden="true">
        <svg className="plan-board__grip" viewBox="0 0 10 16">
          <circle cx="2" cy="2" r="1.1" />
          <circle cx="8" cy="2" r="1.1" />
          <circle cx="2" cy="8" r="1.1" />
          <circle cx="8" cy="8" r="1.1" />
          <circle cx="2" cy="14" r="1.1" />
          <circle cx="8" cy="14" r="1.1" />
        </svg>
      </span>
      <PlanCheckControl
        item={item}
        pending={pending}
        onComplete={onComplete}
        onStart={onStart}
        onStartAndComplete={onStartAndComplete}
        onUncheck={onUncheck}
      />
      <div className="plan-board__main" style={{ paddingLeft: `${depth * 1.15}rem` }}>
        <span className="plan-board__ref">{ref}</span>
        <span className="plan-board__title">{item.title}</span>
        {blocker ? <span className="plan-board__blocked">{blocker}</span> : null}
      </div>
      <span className={isTaskState(item.state) ? taskStateClass("task-list-row__state", item.state) : "task-list-row__state"}>
        {stateLabel(item.state)}
      </span>
      {editable ? (
        <HoursInput
          className="plan-board__hours"
          value={hours.hours}
          ariaLabel={`Hours for ${ref}`}
          placeholder="— h"
          onCommit={onHours}
        />
      ) : (
        <span className="plan-board__hours-text">{hoursText(hours.hours)}</span>
      )}
      <span className="plan-board__assignee">{item.assignee?.displayName ?? "—"}</span>
      <span className="plan-board__due">{dueLabel(item.dueDate)}</span>
    </div>
  );
}

function PlanPhaseSection({
  phase,
  collapsed,
  canWriteItems,
  pendingItemId,
  onToggle,
  onComplete,
  onStart,
  onStartAndComplete,
  onUncheck,
  onHours,
}: {
  phase: PlanBoardPhase;
  collapsed: boolean;
  canWriteItems: boolean;
  pendingItemId: number | null;
  onToggle: () => void;
  onComplete: (item: PlanBoardItem) => void;
  onStart: (item: PlanBoardItem) => void;
  onStartAndComplete: (item: PlanBoardItem) => void;
  onUncheck: (item: PlanBoardItem) => void;
  onHours: (item: PlanBoardItem, hours: number | null) => void;
}) {
  const accent = planPhaseAccent(phase.color);
  const unestimated = planUnestimatedLabel(phase.rollup.unestimatedCount);
  return (
    <section className="plan-board__phase" aria-label={phase.name}>
      <div className="plan-board__phase-head">
        <button
          type="button"
          className="plan-board__collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${phase.name}` : `Collapse ${phase.name}`}
          onClick={onToggle}
        >
          <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
        </button>
        <h2 className="plan-board__phase-name">
          {accent ? <span className="plan-board__swatch" style={{ background: accent }} /> : null}
          {phase.name}
        </h2>
        <p className="plan-board__phase-hours">{planHoursSummary(phase.rollup.hoursDone, phase.rollup.hoursTotal)}</p>
        <ProgressMeter rollup={phase.rollup} label={`${phase.name} progress`} />
        {unestimated ? <p className="plan-board__warn">{unestimated}</p> : null}
      </div>
      {collapsed ? null : phase.items.length === 0 ? (
        <p className="muted plan-board__empty">No items in this phase.</p>
      ) : (
        <div className="plan-board__scroll">
          <div className="plan-board__table" role="table" aria-label={phase.name}>
            <div className="plan-board__row plan-board__row--head" role="row">
              <span />
              <span />
              <span>Item</span>
              <span>State</span>
              <span>Hours</span>
              <span>Assignee</span>
              <span>Due</span>
            </div>
            {phase.items.map((item) => (
              <PlanRow
                key={item.id}
                item={item}
                items={phase.items}
                canWriteItems={canWriteItems}
                pending={pendingItemId === item.id}
                onComplete={() => onComplete(item)}
                onStart={() => onStart(item)}
                onStartAndComplete={() => onStartAndComplete(item)}
                onUncheck={() => onUncheck(item)}
                onHours={(hours) => onHours(item, hours)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PlanBoardView({ planId, userId }: { planId: number; userId: number }) {
  const qc = useQueryClient();
  const storageKey = planPhaseCollapseKey(userId, planId);
  const [collapsed, setCollapsed] = useState<number[]>(() =>
    readCollapsedPhaseIds(localStorage.getItem(storageKey)),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [reopen, setReopen] = useState<PlanBoardItem | null>(null);

  const boardQuery = useQuery({
    queryKey: ["plan-board", planId],
    queryFn: async () => {
      const res = await apiJson<{ data: PlanBoard }>(`/api/v1/plans/${planId}/board`);
      return res.data;
    },
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["plan-board", planId] });
  };

  const stateMut = useMutation({
    mutationFn: async (body: { itemId: number; to: string; stateComment?: string }) => {
      await apiJson(`/api/v1/plans/${planId}/items/${body.itemId}/state`, {
        method: "POST",
        body: JSON.stringify({ to: body.to, stateComment: body.stateComment ?? null }),
      });
    },
    onSuccess: async () => {
      setNotice(null);
      await refresh();
    },
    onError: async (err: Error) => {
      setNotice(err.message);
      await refresh();
    },
  });

  const hoursMut = useMutation({
    mutationFn: async (body: { item: PlanBoardItem; hours: number | null }) => {
      const patch = { estimateHours: body.hours };
      if (body.item.entityType === "task") {
        await patchTaskRecord(body.item.entityId, patch, boardQuery.data?.plan.projectId ?? null);
        return;
      }
      await apiJson(`/api/v1/todos/${body.item.entityId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
    onSuccess: async () => {
      setNotice(null);
      await refresh();
    },
    onError: (err: Error) => {
      setNotice(err.message);
    },
  });

  const togglePhase = (phaseId: number) => {
    setCollapsed((current) => {
      const next = current.includes(phaseId)
        ? current.filter((id) => id !== phaseId)
        : [...current, phaseId];
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  if (boardQuery.isLoading) return <p className="muted">Loading plan…</p>;
  if (boardQuery.error || !boardQuery.data) {
    const message =
      boardQuery.error instanceof ApiRequestError
        ? boardQuery.error.message
        : ((boardQuery.error as Error | null)?.message ?? "Plan not found");
    return <p role="alert">{message}</p>;
  }

  const board = boardQuery.data;
  const pendingItemId = stateMut.isPending ? (stateMut.variables?.itemId ?? null) : null;

  const postState = (item: PlanBoardItem, to: string, stateComment?: string) => {
    stateMut.mutate({ itemId: item.id, to, stateComment });
  };

  return (
    <div className="plan-board">
      <header className="page-head plan-board__head">
        <div>
          <p className="muted plan-board__ref-line">{formatEntityRef("plan", board.plan.number)}</p>
          <h1>{board.plan.title}</h1>
        </div>
        <span className="plan-board__finish">Finish date —</span>
      </header>
      {notice ? (
        <p className="plan-board__notice" role="alert">
          {notice}
        </p>
      ) : null}
      <RollupSummary rollup={board.rollup} />
      {board.phases.map((phase) => (
        <PlanPhaseSection
          key={phase.id}
          phase={phase}
          collapsed={collapsed.includes(phase.id)}
          canWriteItems={board.permissions.canWriteItems}
          pendingItemId={pendingItemId}
          onToggle={() => togglePhase(phase.id)}
          onComplete={(item) => postState(item, "complete")}
          onStart={(item) => postState(item, "in_progress")}
          onStartAndComplete={(item) => postState(item, "complete")}
          onUncheck={(item) => {
            const action = planCheckAction(item);
            if (action.kind !== "uncheck") return;
            if (action.needsComment) {
              setReopen(item);
              return;
            }
            postState(item, action.to);
          }}
          onHours={(item, hours) => hoursMut.mutate({ item, hours })}
        />
      ))}
      <StateReasonDialog
        open={reopen != null}
        title="Reopen task"
        message="Add a comment explaining why this task is reopened."
        confirmLabel="Reopen"
        onCancel={() => setReopen(null)}
        onConfirm={(comment) => {
          if (!reopen) return;
          const item = reopen;
          setReopen(null);
          postState(item, "ready", comment);
        }}
      />
    </div>
  );
}

export function PlanBoardPage() {
  const { planId: planIdParam } = useParams();
  const planId = Number(planIdParam);
  const { user } = useAuth();

  if (!Number.isFinite(planId) || planId <= 0) {
    return <p role="alert">Invalid plan id</p>;
  }
  if (!user) return null;

  return <PlanBoardView key={`${user.id}:${planId}`} planId={planId} userId={user.id} />;
}
