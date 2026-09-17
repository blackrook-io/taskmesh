import type { ReactNode } from "react";
import { RowTagChips } from "./RowTagChips";
import { TaskListSortHeaderBtn } from "./TaskListSortHeaderBtn";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATE_LABELS,
  formatTaskNumber,
  taskPriorityClass,
  taskStateClass,
  type TaskPriority,
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
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onPatch?: (patch: { priority?: TaskPriority; dueDate?: string | null }) => void;
  projectName?: (id: number | null) => string;
  phaseName?: (id: number | null) => string;
  showTagsInTitle?: boolean;
  childIndentPx?: number;
};

function taskDue(task: Task): string | null {
  return task.dueDate ?? (task.dueAt ? task.dueAt.slice(0, 10) : null);
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
              aria-label={collapsed ? "Expand child tasks" : "Collapse child tasks"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse?.();
              }}
            >
              {collapsed ? "▸" : "▾"}
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
    case "state":
      return (
        <span
          key="state"
          className={taskStateClass("task-list-row__state", task.state)}
          data-ctx-field="state"
        >
          {TASK_STATE_LABELS[task.state]}
        </span>
      );
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
        <select
          key="priority"
          className={taskPriorityClass("task-list-row__priority", task.priority)}
          value={task.priority}
          data-ctx-field="priority"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onPatch({ priority: e.target.value as TaskPriority })}
          aria-label="Priority"
        >
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {TASK_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
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
