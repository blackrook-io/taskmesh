/* eslint-disable react-refresh/only-export-components -- header component + cell renderer helpers */
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  taskPriorityClass,
  taskStateClass,
  type TaskPriority,
  type TaskState,
} from "../../lib/taskFields";
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
  /** Descendants hidden while this parent is collapsed. */
  hiddenCount?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onPatch?: (patch: { priority?: TaskPriority; dueDate?: string | null }) => void;
  onRequestState?: (next: TaskState) => void;
  projectName?: (id: number | null) => string;
  phaseName?: (id: number | null) => string;
  showTagsInTitle?: boolean;
  childIndentPx?: number;
};

function TaskStateReadout({ state }: { state: TaskState }) {
  const describedBy = useContext(stateWaitingDescribedBy);
  return (
    <span
      className={taskStateClass("task-list-row__state", state)}
      data-ctx-field="state"
      aria-describedby={describedBy}
    >
      {TASK_STATE_LABELS[state]}
    </span>
  );
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

export function renderTaskColumnCell(
  fieldKey: string,
  ctx: TaskColumnCellContext,
): ReactNode {
  const {
    task,
    depth,
    duplicate,
    hasChildren,
    hiddenCount = 0,
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
            <button
              type="button"
              className="task-list-row__twist"
              aria-expanded={!collapsed}
              aria-label={
                collapsed
                  ? `Expand child tasks, ${hiddenCount} hidden`
                  : "Collapse child tasks"
              }
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse?.();
              }}
            >
              {collapsed ? "▸" : "▾"}
              {collapsed && hiddenCount > 0 ? (
                <span className="task-list-row__hidden-count">{hiddenCount}</span>
              ) : null}
            </button>
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
      const nextStates = allowedTaskStates(task.allowedNextStates).filter(
        (state) => state !== task.state,
      );
      const stateOptions = [task.state, ...nextStates];
      const control = onRequestState ? (
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
        <TaskStateReadout state={task.state} />
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
          onChange={(e) => onPatch({ dueDate: e.target.value || null })}
          aria-label="Due date"
        />
      ) : (
        <span key="dueDate" className="task-list-row__date muted">
          {formatListDate(taskDue(task))}
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
