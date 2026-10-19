/* eslint-disable react-refresh/only-export-components -- header component + cell renderer helpers */
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TaskRollupMeter } from "../TaskRollupMeter";
import { HoursInput } from "./HoursInput";
import { RowTagChips } from "./RowTagChips";
import { stateWaitingDescribedBy } from "./stateWaitingDescribedBy";
import { StateWaitingHint } from "./StateWaitingHint";
import { TaskListSortHeaderBtn } from "./TaskListSortHeaderBtn";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATE_LABELS,
  allowedTaskStates,
  formatTaskNumber,
  isClosedTaskState,
  isDerivedTaskStatus,
  taskPriorityClass,
  taskStateClass,
  type TaskPriority,
  type TaskState,
} from "../../lib/taskFields";
import { dateOrderViolation } from "../../../../src/lib/dateOrder.ts";
import { formatListDate, type ResolvedListColumn } from "../../lib/listViewColumns";
import type { Task } from "../../types";

export type TaskListSortTrigger = "click" | "doubleClick";

type HeaderProps = {
  columns: ResolvedListColumn[];
  sortCol: string | null;
  sortDir: 1 | -1;
  onSort: (col: string) => void;
  sortTrigger?: TaskListSortTrigger;
};

export function TaskListColumnHeaders({
  columns,
  sortCol,
  sortDir,
  onSort,
  sortTrigger = "doubleClick",
}: HeaderProps) {
  return (
    <>
      {columns.map((col) => {
        if (!col.sortable) {
          return <span key={col.fieldKey}>{col.label}</span>;
        }
        const sorted = sortCol === col.fieldKey;
        if (sortTrigger === "click") {
          return (
            <TaskListSortHeaderBtn
              key={col.fieldKey}
              sorted={sorted}
              dir={sortDir}
              onClick={() => onSort(col.fieldKey)}
            >
              {col.label}
            </TaskListSortHeaderBtn>
          );
        }
        return (
          <TaskListSortHeaderBtn
            key={col.fieldKey}
            sorted={sorted}
            dir={sortDir}
            onDoubleClick={() => onSort(col.fieldKey)}
          >
            {col.label}
          </TaskListSortHeaderBtn>
        );
      })}
    </>
  );
}

export type TaskColumnCellContext = {
  task: Task;
  depth: number;
  duplicate?: boolean;
  hasChildren?: boolean;
  /** Descendants the list would show if this parent were expanded. Not displayed. */
  hiddenCount?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onPatch?: (patch: {
    priority?: TaskPriority;
    dueDate?: string | null;
    startDate?: string | null;
    estimateHours?: number | null;
  }) => void;
  onRequestState?: (next: TaskState) => void;
  projectName?: (id: number | null) => string;
  phaseName?: (id: number | null) => string;
  showTagsInTitle?: boolean;
  childIndentPx?: number;
};

function TaskStateReadout({ state, title }: { state: TaskState; title?: string }) {
  const describedBy = useContext(stateWaitingDescribedBy);
  return (
    <span
      className={taskStateClass("task-list-row__state", state)}
      data-ctx-field="state"
      aria-describedby={describedBy}
      title={title}
    >
      {TASK_STATE_LABELS[state]}
    </span>
  );
}

function rejectInvertedDates(
  input: HTMLInputElement,
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  const message = dateOrderViolation(start, end);
  if (!message) {
    input.setCustomValidity("");
    return false;
  }
  input.setCustomValidity(message);
  input.reportValidity();
  return true;
}

function taskDue(task: Task): string | null {
  return task.dueDate ?? (task.dueAt ? task.dueAt.slice(0, 10) : null);
}

type ListRowOption = {
  value: string;
  label: string;
  className: string;
};

/** Themed list menu. Native `<select>` popups stay on the light system background. */
function ListRowSelect({
  value,
  options,
  disabled,
  className,
  ariaLabel,
  field,
  onChange,
}: {
  value: string;
  options: ListRowOption[];
  disabled?: boolean;
  className: string;
  ariaLabel: string;
  field: "state" | "priority";
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const describedBy = useContext(stateWaitingDescribedBy);
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const estimated = options.length * 34 + 10;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow < estimated && rect.top > estimated ? rect.top - estimated - 4 : rect.bottom + 4;
    setPos({
      top,
      left: Math.max(8, rect.left),
      minWidth: Math.max(rect.width, 136),
    });
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`task-list-row__menu ${className}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-describedby={describedBy}
        data-ctx-field={field}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <span className="task-list-row__menu-label">{current?.label ?? ""}</span>
        <span className="task-list-row__menu-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && pos
        ? createPortal(
            <ul
              ref={menuRef}
              className="task-list-row__menu-list"
              role="listbox"
              aria-label={ariaLabel}
              style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}
            >
              {options.map((option) => (
                <li key={option.value} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    className={`task-list-row__menu-option ${option.className}${
                      option.value === value ? " is-selected" : ""
                    }`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpen(false);
                      if (option.value !== value) onChange(option.value);
                    }}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </>
  );
}

function childTwistLabel(
  collapsed: boolean | undefined,
  done: number | null | undefined,
  total: number | null | undefined,
): string {
  const action = collapsed ? "Expand child tasks" : "Collapse child tasks";
  if (done == null || total == null) return action;
  return `${action}, ${done} of ${total} complete`;
}

export function renderTaskColumnCell(
  fieldKey: string,
  ctx: TaskColumnCellContext,
): ReactNode {
  const {
    task,
    depth,
    duplicate,
    hasChildren,
    collapsed,
    onToggleCollapse,
    onPatch,
    onRequestState,
    projectName,
    phaseName,
    showTagsInTitle = false,
    childIndentPx = 14,
  } = ctx;

  switch (fieldKey) {
    case "number":
      return (
        <span key="number" className="task-list-row__num">
          <span className="muted">{formatTaskNumber(task.number)}</span>
          {hasChildren ? (
            <span className="task-list-row__twist-slot">
              <button
                type="button"
                className="task-list-row__twist"
                aria-expanded={!collapsed}
                aria-label={childTwistLabel(collapsed, task.rollupDone, task.rollupTotal)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse?.();
                }}
              >
                {collapsed ? "▸" : "▾"}
              </button>
              {task.rollupDone != null && task.rollupTotal != null ? (
                <TaskRollupMeter
                  done={task.rollupDone}
                  total={task.rollupTotal}
                  labelled={false}
                />
              ) : null}
            </span>
          ) : null}
        </span>
      );
    case "title":
      return (
        <span key="title" className="task-list-row__title">
          {depth > 0 ? (
            <span
              className="task-list-row__child-indent"
              style={{ width: depth * childIndentPx }}
              aria-hidden
            >
              <span className="task-list-row__child-mark">↳</span>
            </span>
          ) : null}
          <span className="task-list-row__title-text">{task.title}</span>
          {duplicate ? (
            <span className="task-list-row__duplicate" title="Also shown in another group">
              Duplicate
            </span>
          ) : null}
          {showTagsInTitle ? <RowTagChips entityType="task" entityId={task.id} /> : null}
        </span>
      );
    case "state": {
      const derived = isDerivedTaskStatus(task);
      const nextStates = allowedTaskStates(task.allowedNextStates).filter(
        (state) => state !== task.state,
      );
      const stateOptions = [task.state, ...nextStates];
      const control = onRequestState && !derived ? (
        <ListRowSelect
          value={task.state}
          disabled={nextStates.length === 0}
          className={taskStateClass("task-list-row__state", task.state)}
          ariaLabel="State"
          field="state"
          options={stateOptions.map((state) => ({
            value: state,
            label: TASK_STATE_LABELS[state],
            className: taskStateClass("task-list-row__state", state),
          }))}
          onChange={(next) => onRequestState(next as TaskState)}
        />
      ) : (
        <TaskStateReadout
          state={task.state}
          title={derived ? "Derived from child tasks" : undefined}
        />
      );
      return (
        <StateWaitingHint key="state" taskId={task.id} state={task.state}>
          {control}
        </StateWaitingHint>
      );
    }
    case "assignee":
      return (
        <span
          key="assignee"
          className="task-list-row__assignee"
          title={task.assignee?.displayName ?? undefined}
        >
          {task.assignee?.displayName ?? <span className="muted">—</span>}
        </span>
      );
    case "priority":
      return onPatch ? (
        <ListRowSelect
          key="priority"
          value={task.priority}
          disabled={isClosedTaskState(task.state)}
          className={taskPriorityClass("task-list-row__priority", task.priority)}
          ariaLabel="Priority"
          field="priority"
          options={TASK_PRIORITIES.map((priority) => ({
            value: priority,
            label: TASK_PRIORITY_LABELS[priority],
            className: taskPriorityClass("task-list-row__priority", priority),
          }))}
          onChange={(next) => onPatch({ priority: next as TaskPriority })}
        />
      ) : (
        <span key="priority" className={taskPriorityClass("task-list-row__priority", task.priority)}>
          {TASK_PRIORITY_LABELS[task.priority]}
        </span>
      );
    case "startDate":
      return onPatch ? (
        <input
          key="startDate"
          type="date"
          className="task-list-row__date"
          value={task.startDate ?? ""}
          disabled={isClosedTaskState(task.state)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const next = e.target.value || null;
            if (rejectInvertedDates(e.target, next, taskDue(task))) return;
            onPatch({ startDate: next });
          }}
          aria-label="Start date"
        />
      ) : (
        <span key="startDate" className="task-list-row__date muted">
          {formatListDate(task.startDate)}
        </span>
      );
    case "dueDate":
      return onPatch ? (
        <input
          key="dueDate"
          type="date"
          className="task-list-row__date"
          value={taskDue(task) ?? ""}
          disabled={isClosedTaskState(task.state)}
          data-ctx-field="dueDate"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const next = e.target.value || null;
            if (rejectInvertedDates(e.target, task.startDate, next)) return;
            onPatch({ dueDate: next });
          }}
          aria-label="Due date"
        />
      ) : (
        <span key="dueDate" className="task-list-row__date muted">
          {formatListDate(taskDue(task))}
        </span>
      );
    case "estimateHours":
      return onPatch ? (
        <HoursInput
          key="estimateHours"
          className="task-list-row__date"
          value={task.estimateHours}
          disabled={isClosedTaskState(task.state)}
          ariaLabel="Hours"
          onCommit={(next) => onPatch({ estimateHours: next })}
        />
      ) : (
        <span key="estimateHours" className="task-list-row__date muted">
          {task.estimateHours == null ? "—" : task.estimateHours}
        </span>
      );
    case "project":
      return (
        <span key="project" className="task-list-row__project" title={projectName?.(task.projectId)}>
          {projectName?.(task.projectId) || <span className="muted">—</span>}
        </span>
      );
    case "phase":
      return (
        <span key="phase" className="task-list-row__phase muted">
          {phaseName?.(task.phaseId) || "—"}
        </span>
      );
    case "tags":
      return (
        <span key="tags" className="task-list-row__tags">
          <RowTagChips entityType="task" entityId={task.id} />
        </span>
      );
    case "createdAt":
      return (
        <span key="createdAt" className="muted">
          {formatListDate(task.createdAt)}
        </span>
      );
    case "updatedAt":
      return (
        <span key="updatedAt" className="muted">
          {formatListDate(task.updatedAt)}
        </span>
      );
    case "owner":
      return (
        <span key="owner" className="task-list-row__assignee" title={task.owner?.displayName}>
          {task.owner?.displayName ?? <span className="muted">—</span>}
        </span>
      );
    case "createdBy":
      return (
        <span
          key="createdBy"
          className="task-list-row__assignee"
          title={task.createdBy?.displayName}
        >
          {task.createdBy?.displayName ?? <span className="muted">—</span>}
        </span>
      );
    default:
      return <span key={fieldKey} />;
  }
}
