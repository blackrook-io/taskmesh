import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ApiRequestError, apiJson } from "../api/client";
import { StateReasonDialog } from "../components/StateReasonDialog";
import { PlanAiRange } from "../components/PlanAiRange";
import { PlanFinishChip } from "../components/PlanFinishChip";
import { useAssistantBlockedTitle } from "../lib/useAssistantAvailability";
import { PlanTimeline } from "../components/PlanTimeline";
import { PlanPhaseTools, type PlanCandidate } from "../components/PlanPhaseTools";
import { HoursInput } from "../components/shared/HoursInput";
import { useAuth } from "../lib/auth";
import { formatEntityRef } from "../lib/entityRef";
import { patchTaskRecord } from "../lib/patchTask";
import type { PlanProjection } from "../lib/planProjection";
import {
  planBlockerLabel,
  planCheckboxChecked,
  planCheckAction,
  planDependencyGutter,
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
import {
  planAdjacentGap,
  planApplyGap,
  planFixSummary,
  planGapAtPhaseEnd,
  planGapBeforeItem,
  planMovingIds,
  planReorderBody,
  planSlotVerdicts,
  type PlanAutoSortPreview,
  type PlanGap,
  type PlanGapVerdict,
  type PlanOrderPhase,
} from "../lib/planOrder";
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

type HoverSlot = {
  gap: PlanGap;
  target: { kind: "before"; itemId: number } | { kind: "end"; phaseId: number };
  verdict: PlanGapVerdict;
};

type ActiveDrag = {
  itemId: number;
  movingIds: number[];
  verdicts: { before: Map<number, PlanGapVerdict>; phaseEnd: Map<number, PlanGapVerdict> };
  hover: HoverSlot | null;
};

function orderPhases(board: PlanBoard): PlanOrderPhase[] {
  return board.phases.map((phase) => ({
    id: phase.id,
    name: phase.name,
    sortOrder: phase.sortOrder,
    items: phase.items.map((item) => ({
      id: item.id,
      entityType: item.entityType,
      entityId: item.entityId,
      number: item.number,
      title: item.title,
      parentId: item.parentId,
    })),
  }));
}

function activeItemId(id: unknown): number | null {
  const text = String(id);
  if (!text.startsWith("item:")) return null;
  const value = Number(text.slice("item:".length));
  return Number.isFinite(value) ? value : null;
}

function pointerInBottomHalf(event: DragMoveEvent | DragEndEvent): boolean {
  const over = event.over;
  const activator = event.activatorEvent;
  if (!over || !activator || !("clientY" in activator) || typeof activator.clientY !== "number") return false;
  const pointer = activator.clientY + event.delta.y;
  return pointer > over.rect.top + over.rect.height / 2;
}

function gapFromEvent(
  phases: readonly PlanOrderPhase[],
  movingIds: readonly number[],
  event: DragMoveEvent | DragEndEvent,
): PlanGap | null {
  if (!event.over) return null;
  const overId = String(event.over.id);
  if (overId.startsWith("phase:") || overId.startsWith("phase-end:")) {
    const phaseId = Number(overId.split(":")[1]);
    return Number.isFinite(phaseId) ? planGapAtPhaseEnd(phases, movingIds, phaseId) : null;
  }
  const itemId = activeItemId(overId);
  if (itemId == null || movingIds.includes(itemId)) return null;
  if (!pointerInBottomHalf(event)) return planGapBeforeItem(phases, movingIds, itemId);
  const moving = new Set(movingIds);
  for (const phase of phases) {
    const kept = phase.items.filter((item) => !moving.has(item.id));
    const index = kept.findIndex((item) => item.id === itemId);
    if (index >= 0) return { phaseId: phase.id, index: index + 1 };
  }
  return null;
}

function hoverFromEvent(
  phases: readonly PlanOrderPhase[],
  drag: ActiveDrag,
  event: DragMoveEvent | DragEndEvent,
): HoverSlot | null {
  const gap = gapFromEvent(phases, drag.movingIds, event);
  if (!gap) return null;
  const moving = new Set(drag.movingIds);
  const phase = phases.find((candidate) => candidate.id === gap.phaseId);
  const kept = phase?.items.filter((item) => !moving.has(item.id)) ?? [];
  const item = kept[gap.index];
  const denied: PlanGapVerdict = { legal: false, reason: "That move is not allowed", noop: false };
  const verdict = item
    ? (drag.verdicts.before.get(item.id) ?? denied)
    : (drag.verdicts.phaseEnd.get(gap.phaseId) ?? denied);
  return {
    gap,
    target: item ? { kind: "before", itemId: item.id } : { kind: "end", phaseId: gap.phaseId },
    verdict,
  };
}

function Grip() {
  return (
    <svg className="plan-board__grip" viewBox="0 0 10 16" aria-hidden="true">
      <circle cx="2" cy="2" r="1.1" />
      <circle cx="8" cy="2" r="1.1" />
      <circle cx="2" cy="8" r="1.1" />
      <circle cx="8" cy="8" r="1.1" />
      <circle cx="2" cy="14" r="1.1" />
      <circle cx="8" cy="14" r="1.1" />
    </svg>
  );
}

function PlanRow({
  item,
  items,
  canWriteItems,
  pending,
  drag,
  gutter,
  onKeyboard,
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
  drag: ActiveDrag | null;
  gutter: string | null;
  onKeyboard: (itemId: number, direction: "up" | "down") => void;
  onComplete: () => void;
  onStart: () => void;
  onStartAndComplete: () => void;
  onUncheck: () => void;
  onHours: (hours: number | null) => void;
}) {
  const { attributes, listeners, setNodeRef } = useSortable({
    id: `item:${item.id}`,
    disabled: !canWriteItems,
  });
  const depth = planIndentDepth(items, item);
  const hours = planRowHours(items, item);
  const blocker = planBlockerLabel(item.actions.blockedBy);
  const ref = planItemRef(item);
  const editable = canWriteItems && hours.editable;
  const source = drag?.movingIds.includes(item.id) ?? false;
  const before = drag?.verdicts.before.get(item.id);
  const dim = Boolean(drag && !source && before && !before.legal);
  const hovered = drag?.hover?.target.kind === "before" && drag.hover.target.itemId === item.id;
  const reject = Boolean(hovered && drag?.hover && !drag.hover.verdict.legal);
  return (
    <>
      {hovered && drag?.hover?.verdict.reason ? (
        <p className="plan-board__reject" role="status">
          {drag.hover.verdict.reason}
        </p>
      ) : null}
      {hovered && drag?.hover?.verdict.legal && !drag.hover.verdict.noop ? (
        <div className="plan-board__slot-ok" aria-hidden="true" />
      ) : null}
      <div
        ref={setNodeRef}
        className={[
          "plan-board__row",
          dim ? "plan-board__row--dim" : "",
          source ? "plan-board__row--source" : "",
          reject ? "plan-board__row--reject" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="row"
      >
      {gutter != null ? <span className="plan-board__gutter">{gutter}</span> : null}
      {canWriteItems ? (
        <button
          type="button"
          className="plan-board__handle"
          aria-label={`Reorder ${ref}`}
          {...attributes}
          {...listeners}
          onKeyDown={(event) => {
            listeners?.onKeyDown?.(event);
            if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
            event.preventDefault();
            event.stopPropagation();
            onKeyboard(item.id, event.key === "ArrowUp" ? "up" : "down");
          }}
        >
          <Grip />
        </button>
      ) : (
        <span className="plan-board__handle" aria-hidden="true">
          <Grip />
        </span>
      )}
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
    </>
  );
}

function PhaseEndDrop({ phaseId, drag }: { phaseId: number; drag: ActiveDrag | null }) {
  const { setNodeRef } = useDroppable({ id: `phase-end:${phaseId}` });
  const verdict = drag?.verdicts.phaseEnd.get(phaseId);
  const hovered = drag?.hover?.target.kind === "end" && drag.hover.target.phaseId === phaseId;
  return (
    <div
      ref={setNodeRef}
      className={[
        "plan-board__phase-end",
        drag ? "plan-board__phase-end--live" : "",
        drag && verdict && !verdict.legal ? "plan-board__phase-end--dim" : "",
        hovered && verdict?.legal && !verdict.noop ? "plan-board__phase-end--ok" : "",
        hovered && verdict && !verdict.legal ? "plan-board__phase-end--reject" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {hovered && verdict && !verdict.legal && verdict.reason ? (
        <p className="plan-board__reject" role="status">
          {verdict.reason}
        </p>
      ) : null}
    </div>
  );
}

function PlanPhaseSection({
  phase,
  planId,
  collapsed,
  canWriteItems,
  canStructure,
  showDeps,
  allItems,
  edges,
  pendingItemId,
  addBusy,
  pickerOpen,
  drag,
  onKeyboard,
  onToggle,
  onOpenPicker,
  onClosePicker,
  onPick,
  onQuickAdd,
  onComplete,
  onStart,
  onStartAndComplete,
  onUncheck,
  onHours,
}: {
  phase: PlanBoardPhase;
  planId: number;
  collapsed: boolean;
  canWriteItems: boolean;
  canStructure: boolean;
  showDeps: boolean;
  allItems: PlanBoardItem[];
  edges: PlanBoard["edges"];
  pendingItemId: number | null;
  addBusy: boolean;
  pickerOpen: boolean;
  drag: ActiveDrag | null;
  onKeyboard: (itemId: number, direction: "up" | "down") => void;
  onToggle: () => void;
  onOpenPicker: () => void;
  onClosePicker: () => void;
  onPick: (candidate: PlanCandidate) => void;
  onQuickAdd: (title: string, hours: number | null) => Promise<void>;
  onComplete: (item: PlanBoardItem) => void;
  onStart: (item: PlanBoardItem) => void;
  onStartAndComplete: (item: PlanBoardItem) => void;
  onUncheck: (item: PlanBoardItem) => void;
  onHours: (item: PlanBoardItem, hours: number | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `phase:${phase.id}`, disabled: !collapsed });
  const accent = planPhaseAccent(phase.color);
  const unestimated = planUnestimatedLabel(phase.rollup.unestimatedCount);
  const headOver = Boolean(drag && isOver);
  return (
    <section className="plan-board__phase" aria-label={phase.name}>
      <div
        ref={setNodeRef}
        className={headOver ? "plan-board__phase-head plan-board__phase-head--over" : "plan-board__phase-head"}
      >
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
        {canStructure ? (
          <button type="button" className="btn small" onClick={pickerOpen ? onClosePicker : onOpenPicker}>
            {pickerOpen ? "Close" : "+ Add items"}
          </button>
        ) : null}
        <p className="plan-board__phase-hours">{planHoursSummary(phase.rollup.hoursDone, phase.rollup.hoursTotal)}</p>
        <ProgressMeter rollup={phase.rollup} label={`${phase.name} progress`} />
        {unestimated ? <p className="plan-board__warn">{unestimated}</p> : null}
      </div>
      {collapsed ? null : (
        <>
          {phase.items.length === 0 ? (
            <p className="muted plan-board__empty">No items in this phase.</p>
          ) : (
            <div className="plan-board__scroll">
              <div
                className={showDeps ? "plan-board__table plan-board__table--deps" : "plan-board__table"}
                role="table"
                aria-label={phase.name}
              >
                <div className="plan-board__row plan-board__row--head" role="row">
                  {showDeps ? <span>Depends</span> : null}
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
                    drag={drag}
                    gutter={showDeps ? planDependencyGutter(item, allItems, edges) : null}
                    onKeyboard={onKeyboard}
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
          {canWriteItems ? <PhaseEndDrop phaseId={phase.id} drag={drag} /> : null}
          {canStructure && !collapsed ? (
            <PlanPhaseTools
              planId={planId}
              phaseId={phase.id}
              phaseName={phase.name}
              pickerOpen={pickerOpen}
              busy={addBusy}
              onClosePicker={onClosePicker}
              onPick={onPick}
              onQuickAdd={onQuickAdd}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function PlanBoardView({ planId, userId }: { planId: number; userId: number }) {
  const assistantBlocked = useAssistantBlockedTitle();
  const qc = useQueryClient();
  const storageKey = planPhaseCollapseKey(userId, planId);
  const [collapsed, setCollapsed] = useState<number[]>(() =>
    readCollapsedPhaseIds(localStorage.getItem(storageKey)),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [reopen, setReopen] = useState<PlanBoardItem | null>(null);
  const [showDeps, setShowDeps] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") === "timeline" ? "timeline" : "board";
  const setView = (next: "board" | "timeline") => {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (next === "timeline") params.set("view", "timeline");
        else params.delete("view");
        return params;
      },
      { replace: true },
    );
  };
  const [pickerPhaseId, setPickerPhaseId] = useState<number | null>(null);
  const [pendingParent, setPendingParent] = useState<{ phaseId: number; candidate: PlanCandidate } | null>(
    null,
  );
  const [fixDialog, setFixDialog] = useState<{ revision: number; preview: PlanAutoSortPreview } | null>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const [drag, setDrag] = useState<ActiveDrag | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const rememberDrag = (next: ActiveDrag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const boardQuery = useQuery({
    queryKey: ["plan-board", planId],
    queryFn: async () => {
      const res = await apiJson<{ data: PlanBoard }>(`/api/v1/plans/${planId}/board`);
      return res.data;
    },
  });

  const projectionQuery = useQuery({
    queryKey: ["plan-projection", planId],
    queryFn: async () => {
      const res = await apiJson<{ data: PlanProjection }>(`/api/v1/plans/${planId}/projection`);
      return res.data;
    },
  });

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["plan-board", planId] }),
      qc.invalidateQueries({ queryKey: ["plan-projection", planId] }),
    ]);
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

  const capacityMut = useMutation({
    mutationFn: async (hours: number) => {
      await apiJson(`/api/v1/plans/${planId}`, {
        method: "PATCH",
        body: JSON.stringify({ capacityHoursPerWeek: hours }),
      });
    },
    onSuccess: async () => {
      setNotice(null);
      await refresh();
    },
  });

  const reorderMut = useMutation({
    mutationFn: async (body: { revision: number; phases: Array<{ phaseId: number; itemIds: number[] }> }) => {
      const res = await apiJson<{ data: PlanBoard }>(`/api/v1/plans/${planId}/reorder`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: (next) => {
      setNotice(null);
      qc.setQueryData(["plan-board", planId], next);
    },
    onError: async (err: Error) => {
      setNotice(err.message);
      await refresh();
    },
  });

  const addMut = useMutation({
    mutationFn: async (body: {
      phaseId: number;
      entityType: "task" | "todo";
      entityId: number;
      includeChildren: boolean;
    }) => {
      const res = await apiJson<{ data: PlanBoard }>(`/api/v1/plans/${planId}/items`, {
        method: "POST",
        body: JSON.stringify({
          entityType: body.entityType,
          entityId: body.entityId,
          phaseId: body.phaseId,
          includeChildren: body.includeChildren,
        }),
      });
      return res.data;
    },
    onSuccess: (next) => {
      setNotice(null);
      setPendingParent(null);
      setPickerPhaseId(null);
      qc.setQueryData(["plan-board", planId], next);
      void qc.invalidateQueries({ queryKey: ["plan-projection", planId] });
      void qc.invalidateQueries({ queryKey: ["plan-candidates", planId] });
      void qc.invalidateQueries({ queryKey: ["plan-memberships"] });
    },
    onError: (err: Error) => {
      setNotice(err.message);
    },
  });

  const quickAdd = async (phaseId: number, title: string, hours: number | null) => {
    const projectId = boardQuery.data?.plan.projectId ?? null;
    try {
      const created = await apiJson<{ data: { id: number } }>(
        projectId != null ? `/api/v1/projects/${projectId}/tasks` : "/api/v1/tasks",
        {
          method: "POST",
          body: JSON.stringify({ title, state: "new", estimateHours: hours }),
        },
      );
      addMut.mutate({
        phaseId,
        entityType: "task",
        entityId: created.data.id,
        includeChildren: false,
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not add the task");
      throw err;
    }
  };

  const fixMut = useMutation({
    mutationFn: async (body: { revision: number; apply: boolean }) => {
      const res = await apiJson<{
        data: { revision: number; preview: PlanAutoSortPreview; board: PlanBoard | null };
      }>(`/api/v1/plans/${planId}/auto-sort`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: (data, variables) => {
      if (!variables.apply) {
        setFixDialog({ revision: data.revision, preview: data.preview });
        return;
      }
      setFixDialog(null);
      setNotice(null);
      if (data.board) qc.setQueryData(["plan-board", planId], data.board);
      else void refresh();
    },
    onError: async (err: Error) => {
      setNotice(err.message);
      setFixDialog(null);
      await refresh();
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

  const phases = orderPhases(board);
  const edges = board.edges ?? [];
  const canWriteItems = board.permissions.canWriteItems;
  const canStructure = board.permissions.canStructure;
  const allItems = board.phases.flatMap((phase) => phase.items);
  const sortableIds = board.phases
    .filter((phase) => !collapsed.includes(phase.id))
    .flatMap((phase) => phase.items.map((item) => `item:${item.id}`));
  const fixSummary = fixDialog ? planFixSummary(phases, fixDialog.preview) : null;

  const trackHover = (event: DragMoveEvent) => {
    const current = dragRef.current;
    if (!current) return;
    const hover = hoverFromEvent(phases, current, event);
    const previous = current.hover;
    const same =
      previous?.target.kind === hover?.target.kind &&
      (previous?.target.kind === "before" ? previous.target.itemId : previous?.target.phaseId) ===
        (hover?.target.kind === "before" ? hover.target.itemId : hover?.target.phaseId) &&
      previous?.verdict.legal === hover?.verdict.legal &&
      previous?.verdict.reason === hover?.verdict.reason;
    if (same) return;
    rememberDrag({ ...current, hover });
  };

  const onDragStart = (event: DragStartEvent) => {
    if (!canWriteItems || reorderMut.isPending) return;
    const itemId = activeItemId(event.active.id);
    if (itemId == null) return;
    const movingIds = planMovingIds(phases, itemId);
    rememberDrag({
      itemId,
      movingIds,
      verdicts: planSlotVerdicts(phases, movingIds, edges),
      hover: null,
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const current = dragRef.current;
    rememberDrag(null);
    if (!current) return;
    const hover = event.over ? hoverFromEvent(phases, current, event) : current.hover;
    if (!hover || !hover.verdict.legal) {
      if (hover?.verdict.reason) setNotice(hover.verdict.reason);
      return;
    }
    if (hover.verdict.noop) return;
    setNotice(null);
    reorderMut.mutate(planReorderBody(board.plan.revision, planApplyGap(phases, current.movingIds, hover.gap)));
  };

  const onKeyboard = (itemId: number, direction: "up" | "down") => {
    if (!canWriteItems || reorderMut.isPending) return;
    const step = planAdjacentGap(phases, itemId, direction, edges);
    if (!step.gap || !step.verdict.legal) {
      setNotice(step.verdict.reason);
      return;
    }
    if (step.verdict.noop) {
      setNotice(null);
      return;
    }
    setNotice(null);
    const movingIds = planMovingIds(phases, itemId);
    reorderMut.mutate(planReorderBody(board.plan.revision, planApplyGap(phases, movingIds, step.gap)));
  };

  const overlay = drag
    ? phases.flatMap((phase) => phase.items).filter((item) => drag.movingIds.includes(item.id))
    : [];

  return (
    <div className="plan-board">
      <header className="page-head plan-board__head">
        <div>
          <p className="muted plan-board__ref-line">{formatEntityRef("plan", board.plan.number)}</p>
          <h1>{board.plan.title}</h1>
        </div>
        <div className="plan-board__actions">
          <div className="plan-board__view" role="group" aria-label="Plan view">
            <button type="button" className="btn" aria-pressed={view === "board"} onClick={() => setView("board")}>
              Board
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={view === "timeline"}
              onClick={() => setView("timeline")}
            >
              Timeline
            </button>
          </div>
          {view === "board" ? (
          <button
            type="button"
            className="btn"
            aria-pressed={showDeps}
            onClick={() => setShowDeps((current) => !current)}
          >
            Show dependencies
          </button>
          ) : null}
          {view === "board" && canWriteItems ? (
            <button
              type="button"
              className="btn"
              disabled={fixMut.isPending}
              onClick={() => fixMut.mutate({ revision: board.plan.revision, apply: false })}
            >
              Fix order
            </button>
          ) : null}
          <PlanFinishChip
            projection={projectionQuery.data}
            pending={capacityMut.isPending}
            onSaveCapacity={(hours) => capacityMut.mutateAsync(hours)}
          />
          <PlanAiRange
            planId={planId}
            projection={projectionQuery.data}
            assistantBlocked={assistantBlocked != null}
          />
        </div>
      </header>
      {notice ? (
        <p className="plan-board__notice" role="alert">
          {notice}
        </p>
      ) : null}
      <RollupSummary rollup={board.rollup} />
      {view === "timeline" ? <PlanTimeline planId={planId} /> : null}
      {view === "board" ? (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragMove={trackHover}
        onDragOver={trackHover}
        onDragCancel={() => rememberDrag(null)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {board.phases.map((phase) => (
            <PlanPhaseSection
              key={phase.id}
              phase={phase}
              planId={planId}
              collapsed={collapsed.includes(phase.id)}
              canWriteItems={canWriteItems}
              canStructure={canStructure}
              showDeps={showDeps}
              allItems={allItems}
              edges={edges}
              pendingItemId={pendingItemId}
              addBusy={addMut.isPending}
              pickerOpen={pickerPhaseId === phase.id}
              drag={canWriteItems ? drag : null}
              onKeyboard={onKeyboard}
              onToggle={() => togglePhase(phase.id)}
              onOpenPicker={() => {
                if (collapsed.includes(phase.id)) togglePhase(phase.id);
                setPickerPhaseId(phase.id);
              }}
              onClosePicker={() => setPickerPhaseId((current) => (current === phase.id ? null : current))}
              onPick={(candidate) => {
                if (candidate.childCount > 0) {
                  setPendingParent({ phaseId: phase.id, candidate });
                  return;
                }
                addMut.mutate({
                  phaseId: phase.id,
                  entityType: candidate.entityType,
                  entityId: candidate.entityId,
                  includeChildren: false,
                });
              }}
              onQuickAdd={(title, hours) => quickAdd(phase.id, title, hours)}
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
        </SortableContext>
        <DragOverlay>
          {overlay.length > 0 ? (
            <div className="plan-board__overlay">
              {overlay.map((item) => (
                <div key={item.id}>
                  {formatEntityRef(item.entityType, item.number)} {item.title}
                </div>
              ))}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      ) : null}
      {fixDialog && fixSummary ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setFixDialog(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fix-order-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="fix-order-title">Fix order</h2>
            {fixSummary.alreadyLegal ? <p>The order is already legal.</p> : null}
            {fixSummary.conflicts.length > 0 ? (
              <>
                <p>These conflicts stay as they are:</p>
                <ul className="plan-board__fix-list">
                  {fixSummary.conflicts.map((conflict) => (
                    <li key={conflict}>{conflict}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {fixSummary.moves.map((phase) => (
              <div key={phase.phaseName}>
                <p>{phase.phaseName}</p>
                <ul className="plan-board__fix-list">
                  {phase.rows.map((row) => (
                    <li key={row.key}>{row.moved ? `${row.label} — moved` : row.label}</li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setFixDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!fixSummary.canApply || fixMut.isPending}
                onClick={() => fixMut.mutate({ revision: fixDialog.revision, apply: true })}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingParent ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingParent(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-children-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="plan-children-title">
              Also add its {pendingParent.candidate.childCount}{" "}
              {pendingParent.candidate.childCount === 1 ? "child" : "children"}?
            </h2>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setPendingParent(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={addMut.isPending}
                onClick={() =>
                  addMut.mutate({
                    phaseId: pendingParent.phaseId,
                    entityType: pendingParent.candidate.entityType,
                    entityId: pendingParent.candidate.entityId,
                    includeChildren: false,
                  })
                }
              >
                No
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={addMut.isPending}
                onClick={() =>
                  addMut.mutate({
                    phaseId: pendingParent.phaseId,
                    entityType: pendingParent.candidate.entityType,
                    entityId: pendingParent.candidate.entityId,
                    includeChildren: true,
                  })
                }
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
