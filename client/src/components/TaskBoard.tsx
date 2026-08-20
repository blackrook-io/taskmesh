import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { apiJson } from "../api/client";
import { useUndoStack } from "../hooks/useUndoStack";
import {
  discardTaskEditSession,
  ensureTaskEditSession,
  flushTaskEditSession,
} from "../lib/taskEditSession";
import type { PatchTaskOptions } from "../lib/patchTask";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  SELECTABLE_TASK_STATES,
  TASK_STATE_LABELS,
  taskPriorityClass,
  taskStateClass,
  formatTaskNumber,
  nextTaskState,
  TASK_STATE_SORT_RANK,
  type TaskPriority,
  type TaskState,
} from "../lib/taskFields";
import type { Project, Task, TaskGroup } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ColorPopover } from "./shared/ColorPopover";
import { GroupEditModal } from "./GroupEditModal";
import { FilterIcon } from "./TaskListFilterBar";
import { ElementShell } from "./shared/ElementShell";
import { MarkdownEditor } from "./shared/MarkdownEditor";
import { RowTagChips } from "./shared/RowTagChips";
import { TagInput } from "./shared/TagInput";
import { TaskDescriptionTemplatesMenu } from "./shared/TaskDescriptionTemplatesMenu";
import {
  fetchOpenDependsOn,
  formatCompleteBlockMessage,
  TaskDependencyLists,
} from "./shared/TaskDependencyLists";
import { TaskHistory } from "./shared/TaskHistory";
import { TaskTimeline } from "./shared/TaskTimeline";
import { TaskListSortHeaderBtn } from "./shared/TaskListSortHeaderBtn";
import {
  DEFAULT_PROJECT_TASK_LIST_SORT,
  storageKeyForProjectTaskSort,
  type TaskListSortCol,
} from "../lib/taskListSort";
import { usePersistedTaskListSort } from "../lib/usePersistedTaskListSort";
import {
  emptyTaskListFilter,
  evaluateTaskListFilter,
  formatFilterBreadcrumb,
  isFilterActive,
  parseTaskListFilterValue,
  type TaskListFilter,
} from "../lib/taskListFilter";

export type TaskReorderPayload = {
  orderedTaskIds: number[];
  parentId?: number | null;
  phaseId?: number | null;
};

type SortCol = Exclude<TaskListSortCol, "project">;

type TaskPatch = {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  color?: string | null;
  phaseId?: number | null;
  parentId?: number | null;
  projectId?: number | null;
  state?: TaskState;
  priority?: TaskPriority;
};

type TaskSnapshot = {
  title: string;
  description: string;
  dueDate: string | null;
  color: string | null;
  phaseId: number | null;
  projectId: number | null;
  state: TaskState;
  priority: TaskPriority;
};

function taskDue(task: Task): string | null {
  return task.dueDate ?? (task.dueAt ? task.dueAt.slice(0, 10) : null);
}

function snapshotFromTask(task: Task): TaskSnapshot {
  return {
    title: task.title,
    description: task.description ?? "",
    dueDate: taskDue(task),
    color: task.color,
    phaseId: task.phaseId,
    projectId: task.projectId,
    state: task.state,
    priority: task.priority,
  };
}

function sortRoots(roots: Task[], col: SortCol | null, dir: 1 | -1): Task[] {
  if (!col) return [...roots].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const priRank: Record<TaskPriority, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
    urgent: 4,
  };
  const stateRank: Record<TaskState, number> = TASK_STATE_SORT_RANK;
  return [...roots].sort((a, b) => {
    let cmp = 0;
    if (col === "number") cmp = a.number - b.number;
    else if (col === "title") cmp = a.title.localeCompare(b.title);
    else if (col === "state") cmp = stateRank[a.state] - stateRank[b.state];
    else if (col === "priority") cmp = priRank[a.priority] - priRank[b.priority];
    else {
      const da = taskDue(a) ?? "";
      const db = taskDue(b) ?? "";
      cmp = da.localeCompare(db);
    }
    return cmp * dir || a.id - b.id;
  });
}

function childrenOf(tasks: Task[], parentId: number): Task[] {
  return tasks
    .filter((t) => t.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

type FlatRow =
  | { kind: "group"; group: TaskGroup | null; key: string; taskCount: number }
  | { kind: "task"; task: Task; depth: number; key: string; groupKey: number | "none"; duplicate: boolean };

function groupFilter(group: TaskGroup): TaskListFilter {
  return parseTaskListFilterValue(group.filter) ?? emptyTaskListFilter();
}

function buildRows(
  groups: TaskGroup[],
  tasks: Task[],
  listFilter: TaskListFilter,
  collapsed: Set<number | "none">,
  sortCol: SortCol | null,
  sortDir: 1 | -1,
): FlatRow[] {
  const orderedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
  const roots = tasks.filter((t) => t.parentId == null);
  const rows: FlatRow[] = [];
  const appearCount = new Map<number, number>();
  const byGroup = new Map<number, Task[]>();

  for (const g of orderedGroups) {
    const gf = groupFilter(g);
    const match = isFilterActive(gf) ? evaluateTaskListFilter(roots, gf) : [];
    byGroup.set(g.id, match);
    for (const t of match) {
      appearCount.set(t.id, (appearCount.get(t.id) ?? 0) + 1);
    }
  }
  const claimed = new Set(appearCount.keys());
  const unassigned = evaluateTaskListFilter(roots, listFilter).filter((t) => !claimed.has(t.id));

  const pushGroup = (group: TaskGroup | null, groupKey: number | "none", groupRoots: Task[]) => {
    rows.push({
      kind: "group",
      group,
      key: `group-${groupKey}`,
      taskCount: groupRoots.length,
    });
    if (collapsed.has(groupKey)) return;
    const sorted = sortRoots(groupRoots, sortCol, sortDir);
    const pushTree = (t: Task, depth: number) => {
      rows.push({
        kind: "task",
        task: t,
        depth,
        key: `task-${groupKey}-${t.id}`,
        groupKey,
        duplicate: (appearCount.get(t.id) ?? 0) > 1,
      });
      for (const c of childrenOf(tasks, t.id)) {
        pushTree(c, depth + 1);
      }
    };
    for (const root of sorted) {
      pushTree(root, 0);
    }
  };

  for (const g of orderedGroups) {
    pushGroup(g, g.id, byGroup.get(g.id) ?? []);
  }
  pushGroup(null, "none", unassigned);
  return rows;
}

export function StateCheckbox({
  state,
  onCycle,
}: {
  state: TaskState;
  onCycle: () => void;
}) {
  const glyph =
    state === "ready"
      ? "○"
      : state === "in_progress"
        ? "/"
        : state === "pending"
          ? "…"
          : state === "complete"
            ? "✓"
            : state === "canceled"
              ? "X"
              : state === "on_hold"
                ? "-"
                : "";
  const hint =
    state === "pending"
      ? `${TASK_STATE_LABELS[state]} — waiting on child tasks — click to cycle`
      : `${TASK_STATE_LABELS[state]} — click to cycle`;
  return (
    <button
      type="button"
      className={taskStateClass("task-state-cb", state)}
      title={hint}
      aria-label={`State ${TASK_STATE_LABELS[state]}`}
      onClick={(e) => {
        e.stopPropagation();
        onCycle();
      }}
    >
      {glyph}
    </button>
  );
}

export function TaskEditorFields({
  task,
  allTasks,
  onSavePatch,
  onRequestClose,
  onDeleted,
  onHeaderActions,
  onOpenTask,
}: {
  task: Task;
  allTasks?: Task[];
  onSavePatch: (
    patch: TaskPatch,
    opts?: PatchTaskOptions,
  ) => Promise<Task | void> | Task | void;
  onRequestClose?: () => void;
  /** Called after the task is deleted successfully (close modal / invalidate). */
  onDeleted?: () => void;
  /** Renders controls into the modal header (left of Close). */
  onHeaderActions?: (node: ReactNode) => void;
  /** Open another task in-place (dependency double-click). */
  onOpenTask?: (taskId: number) => void;
}) {
  const qc = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const initial = snapshotFromTask(task);
  const { push, undo, reset, canUndo, revision } = useUndoStack(initial);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [dueLocal, setDueLocal] = useState(initial.dueDate ?? "");
  const [color, setColor] = useState(initial.color);
  const [phaseId, setPhaseId] = useState(initial.phaseId);
  const [projectId, setProjectId] = useState(initial.projectId);
  const [state, setState] = useState(initial.state);
  const [priority, setPriority] = useState(initial.priority);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [completeBlockMsg, setCompleteBlockMsg] = useState<string | null>(null);

  // One History line for the whole time this task editor is open (survives remounts).
  ensureTaskEditSession(task.id, {
    title: task.title,
    description: task.description ?? null,
    state: task.state,
    priority: task.priority,
    dueDate: taskDue(task),
    color: task.color,
    phaseId: task.phaseId,
    parentId: task.parentId,
    projectId: task.projectId,
  });

  const flushSessionHistory = async () => {
    try {
      await flushTaskEditSession(task.id);
      void qc.invalidateQueries({ queryKey: ["task-activity", task.id] });
    } catch {
      // Closing should still succeed if History flush fails.
    }
  };
  const flushSessionHistoryRef = useRef(flushSessionHistory);
  flushSessionHistoryRef.current = flushSessionHistory;

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects");
      return res.data;
    },
  });

  const knownChildren = (allTasks ?? []).filter((t) => t.parentId === task.id);
  const childrenQuery = useQuery({
    queryKey: ["tasks", "children-of", task.id],
    enabled: deleteOpen && allTasks === undefined,
    queryFn: async () => {
      const res = await apiJson<{ data: Task[] }>("/api/v1/tasks");
      return res.data.filter((t) => t.parentId === task.id);
    },
  });
  const children = allTasks !== undefined ? knownChildren : (childrenQuery.data ?? knownChildren);

  useEffect(() => {
    const snap = snapshotFromTask(task);
    reset(snap);
    setTitle(snap.title);
    setDescription(snap.description);
    setDueLocal(snap.dueDate ?? "");
    setColor(snap.color);
    setPhaseId(snap.phaseId);
    setProjectId(snap.projectId);
    setState(snap.state);
    setPriority(snap.priority);
    setSaveError(null);
  }, [task.id, reset]);

  useEffect(() => {
    setProjectId(task.projectId);
    setPhaseId(task.phaseId);
  }, [task.projectId, task.phaseId]);

  const currentSnap = (): TaskSnapshot => ({
    title,
    description,
    dueDate: dueLocal || null,
    color,
    phaseId,
    projectId,
    state,
    priority,
  });

  const applySnap = (snap: TaskSnapshot) => {
    setTitle(snap.title);
    setDescription(snap.description);
    setDueLocal(snap.dueDate ?? "");
    setColor(snap.color);
    setPhaseId(snap.phaseId);
    setProjectId(snap.projectId);
    setState(snap.state);
    setPriority(snap.priority);
  };

  const applyServerTask = (row: Task) => {
    setTitle(row.title);
    setDescription(row.description ?? "");
    setDueLocal(taskDue(row) ?? "");
    setColor(row.color);
    setPhaseId(row.phaseId);
    setProjectId(row.projectId);
    setState(row.state);
    setPriority(row.priority);
  };

  const commit = async (previous: TaskSnapshot, patch: TaskPatch) => {
    push(previous);
    try {
      const updated = await onSavePatch(patch, { deferHistory: true });
      if (updated) applyServerTask(updated);
      setSaveError(null);
      if (patch.projectId !== undefined) {
        void qc.invalidateQueries({ queryKey: ["phases", patch.projectId] });
        void qc.invalidateQueries({ queryKey: ["tasks"] });
      }
    } catch (err) {
      setSaveError((err as Error).message);
      applySnap(previous);
    }
  };

  const handleUndo = async () => {
    const restored = undo();
    applySnap(restored);
    try {
      const updated = await onSavePatch(
        {
          title: restored.title,
          description: restored.description.trim() ? restored.description : null,
          dueDate: restored.dueDate,
          color: restored.color,
          phaseId: restored.phaseId,
          projectId: restored.projectId,
          state: restored.state,
          priority: restored.priority,
        },
        { deferHistory: true },
      );
      if (updated) applyServerTask(updated);
      setSaveError(null);
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  const handleUndoRef = useRef(handleUndo);
  handleUndoRef.current = handleUndo;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void (async () => {
          await flushSessionHistoryRef.current();
          onRequestClose?.();
        })();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.(".ProseMirror")) return;
        e.preventDefault();
        void handleUndoRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onRequestClose]);

  // Flush session History when the modal unmounts (Close / backdrop / navigate).
  useEffect(() => {
    return () => {
      void flushSessionHistoryRef.current();
    };
  }, []);

  // When the editor body overflows vertically, widen the modal by the
  // scrollbar width + 10px so the scrollbar doesn't cover content on the right.
  useEffect(() => {
    const el = containerRef.current;
    const dialog = el?.closest('[role="dialog"]') as HTMLElement | null;
    if (!el || !dialog) return;
    let raf = 0;
    const GAP = 20;
    const measure = () => {
      const scrollbarWidth = el.offsetWidth - el.clientWidth;
      const hasScroll = el.scrollHeight > el.clientHeight + 1;
      if (hasScroll) {
        // Gap between content and scrollbar, plus modal growth to keep content width.
        el.style.paddingRight = `${GAP}px`;
        dialog.style.setProperty("--task-modal-extra", `${Math.max(scrollbarWidth, 0) + GAP}px`);
      } else {
        el.style.paddingRight = "";
        dialog.style.setProperty("--task-modal-extra", "0px");
      }
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      dialog.style.removeProperty("--task-modal-extra");
      el.style.paddingRight = "";
    };
  }, []);

  useEffect(() => {
    if (!onHeaderActions) return;
    onHeaderActions(
      <button
        type="button"
        className="btn small ghost"
        disabled={!canUndo}
        onClick={() => void handleUndo()}
        title="Revert last saved change (Ctrl+Z)"
      >
        Undo
      </button>,
    );
    return () => onHeaderActions(null);
  }, [canUndo, onHeaderActions]);

  return (
    <div className="task-expand" ref={containerRef}>
      <div className="field">
        <label htmlFor={`t-title-${task.id}`}>Title</label>
        <input
          id={`t-title-${task.id}`}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title !== task.title) {
              void commit({ ...currentSnap(), title: task.title }, { title });
            }
          }}
        />
      </div>
      <div className="task-editor-grid">
        <div className="field">
          <label htmlFor={`t-project-${task.id}`}>Project</label>
          <select
            id={`t-project-${task.id}`}
            value={projectId ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              const nextProject = raw === "" ? null : Number(raw);
              const prev = { ...currentSnap(), projectId };
              setProjectId(nextProject);
              if (nextProject == null) setPhaseId(null);
              void commit(prev, { projectId: nextProject });
            }}
          >
            <option value="">No project</option>
            {(projectsQuery.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            </select>
        </div>
        <div className="field">
          <label htmlFor={`t-state-${task.id}`}>State</label>
          <select
            id={`t-state-${task.id}`}
            value={state}
            onChange={(e) => {
              const next = e.target.value as TaskState;
              const prev = { ...currentSnap(), state };
              if (next === "complete") {
                void (async () => {
                  try {
                    const blockers = await fetchOpenDependsOn(task.id);
                    if (blockers.length > 0) {
                      setCompleteBlockMsg(formatCompleteBlockMessage(blockers));
                      return;
                    }
                  } catch (err) {
                    setSaveError((err as Error).message);
                    return;
                  }
                  setState(next);
                  void commit(prev, { state: next });
                })();
                return;
              }
              setState(next);
              void commit(prev, { state: next });
            }}
          >
            {SELECTABLE_TASK_STATES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`t-pri-${task.id}`}>Priority</label>
          <select
            id={`t-pri-${task.id}`}
            value={priority}
            onChange={(e) => {
              const next = e.target.value as TaskPriority;
              const prev = { ...currentSnap(), priority };
              setPriority(next);
              void commit(prev, { priority: next });
            }}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field task-editor-date-color">
          <label htmlFor={`t-due-${task.id}`}>Due date</label>
          <div className="task-editor-date-color__row">
            <input
              id={`t-due-${task.id}`}
              type="date"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
              onBlur={() => {
                const next = dueLocal || null;
                if (next !== taskDue(task)) {
                  void commit({ ...currentSnap(), dueDate: taskDue(task) }, { dueDate: next });
                }
              }}
            />
            <div className="task-color-swatch" title={color ?? "default"}>
              <ColorPopover
                color={color}
                label="Task color"
                placement="left"
                onChange={(c) => {
                  const prev = { ...currentSnap(), color };
                  setColor(c);
                  void commit(prev, { color: c });
                }}
              />
              <span className="task-color-swatch__hex muted">{color ?? "default"}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="field task-expand__notes">
        <div className="task-expand__notes-head">
          <label>Description</label>
          <TaskDescriptionTemplatesMenu
            projectId={projectId}
            description={description}
            onApply={(body) => {
              const prev = { ...currentSnap(), description: task.description ?? "" };
              setDescription(body);
              const normalized = body.trim() ? body : null;
              if (normalized !== (task.description ?? "")) {
                void commit(prev, { description: normalized });
              }
            }}
          />
        </div>
        <MarkdownEditor
          key={`${task.id}-${revision}-description`}
          value={description}
          onChange={setDescription}
          fill
          height={280}
          placeholder="Task description…"
          onBlur={(v) => {
            setDescription(v);
            const normalized = v.trim() ? v : null;
            if (normalized !== (task.description ?? "")) {
              void commit(
                { ...currentSnap(), description: task.description ?? "" },
                { description: normalized },
              );
            }
          }}
        />
      </div>
      <TaskTimeline task={task} />
      <div className="field field--tags-below task-editor-tags-row">
        <span className="task-editor-hint muted">
          Autosaves on blur · History updates on Close · Esc closes · Ctrl+Z undoes
        </span>
        <TagInput entityType="task" entityId={task.id} />
      </div>
      <TaskDependencyLists taskId={task.id} onOpenTask={onOpenTask} />
      <TaskHistory taskId={task.id} />
      {children.length > 0 ? (
        <div className="field">
          <label>Child tasks</label>
          <ul className="task-child-list">
            {children.map((c) => (
              <li key={c.id}>
                <span className="muted">{formatTaskNumber(c.number)}</span> {c.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {saveError ? (
        <p role="alert" className="tag-input__error">
          {saveError}
        </p>
      ) : null}
      <div className="task-expand__footer">
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            setDeleteError(null);
            setDeleteOpen(true);
          }}
        >
          Delete
        </button>
      </div>
      {deleteError && !deleteOpen ? (
        <p role="alert" className="tag-input__error">
          {deleteError}
        </p>
      ) : null}
      <ConfirmDialog
        open={completeBlockMsg != null}
        title="Cannot mark Complete"
        message={completeBlockMsg ?? ""}
        alertOnly
        confirmLabel="OK"
        onCancel={() => setCompleteBlockMsg(null)}
        onConfirm={() => setCompleteBlockMsg(null)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="Delete task?"
        message="The task will be hidden from lists and marked Deleted. It can be restored from Administration → Deleted Tasks."
        warning={
          deleteError
            ? deleteError
            : children.length > 0
              ? `Cannot delete while this task has ${children.length} child task${children.length === 1 ? "" : "s"}. Reparent or delete them first.`
              : undefined
        }
        confirmLabel={
          deleteOpen && allTasks === undefined && childrenQuery.isFetching
            ? "Checking…"
            : deleting
              ? "Deleting…"
              : "Delete"
        }
        confirmDisabled={
          deleting ||
          children.length > 0 ||
          (deleteOpen && allTasks === undefined && childrenQuery.isFetching)
        }
        onCancel={() => {
          if (deleting) return;
          setDeleteOpen(false);
          setDeleteError(null);
        }}
        onConfirm={() => {
          if (deleting) return;
          if (children.length > 0) return;
          if (allTasks === undefined && childrenQuery.isFetching) return;
          void (async () => {
            setDeleting(true);
            setDeleteError(null);
            try {
              await apiJson(`/api/v1/tasks/${task.id}`, { method: "DELETE" });
              discardTaskEditSession(task.id);
              setDeleteOpen(false);
              void qc.invalidateQueries({ queryKey: ["tasks"] });
              onDeleted?.();
              onRequestClose?.();
            } catch (err) {
              setDeleteError((err as Error).message);
            } finally {
              setDeleting(false);
            }
          })();
        }}
      />
    </div>
  );
}

function SortableTaskRow({
  task,
  depth,
  duplicate,
  groupKey,
  onOpen,
  onCycleState,
  onPatch,
}: {
  task: Task;
  depth: number;
  duplicate: boolean;
  groupKey: number | "none";
  onOpen: () => void;
  onCycleState: () => void;
  onPatch: (patch: TaskPatch) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `task-${groupKey}-${task.id}`,
    data: { type: "task", taskId: task.id, parentId: task.parentId, groupKey },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-list-row${isDragging ? " dragging" : ""}${depth > 0 ? " task-list-row--child" : ""}`}
      onDoubleClick={onOpen}
    >
      <span
        className="task-list-row__stripe"
        style={{ background: task.color ?? "transparent" }}
        aria-hidden
      />
      <span className="task-drag-handle" {...attributes} {...listeners} title="Drag to reorder">
        ::
      </span>
      <StateCheckbox state={task.state} onCycle={onCycleState} />
      <span className="task-list-row__num muted" style={{ paddingLeft: depth * 12 }}>
        {depth > 0 ? "↳ " : ""}
        {formatTaskNumber(task.number)}
      </span>
      <span className="task-list-row__title">
        <span className="task-list-row__title-text">{task.title}</span>
        {duplicate ? (
          <span className="task-list-row__duplicate" title="Also shown in another group">
            Duplicate
          </span>
        ) : null}
        <RowTagChips entityType="task" entityId={task.id} />
      </span>
      <span className={taskStateClass("task-list-row__state", task.state)}>
        {TASK_STATE_LABELS[task.state]}
      </span>
      <select
        className={taskPriorityClass("task-list-row__priority", task.priority)}
        value={task.priority}
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
      <input
        type="date"
        className="task-list-row__date"
        value={taskDue(task) ?? ""}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onPatch({ dueDate: e.target.value || null })}
        aria-label="Due date"
      />
    </div>
  );
}

function SortableGroupHeader({
  group,
  collapsed,
  taskCount,
  onToggle,
  onOpenEdit,
  onRequestDelete,
}: {
  group: TaskGroup | null;
  collapsed: boolean;
  taskCount: number;
  onToggle: () => void;
  onOpenEdit?: () => void;
  onRequestDelete?: () => void;
}) {
  const sortableId = group ? `group-${group.id}` : "group-none";
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: { type: "group", groupId: group?.id ?? null },
    disabled: group == null,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(group?.color
      ? { background: `color-mix(in srgb, ${group.color} 42%, var(--bg-elevated, var(--bg)) 58%)` }
      : {}),
  };
  const gf = group ? groupFilter(group) : emptyTaskListFilter();
  const filterOn = group != null && isFilterActive(gf);
  const breadcrumb = filterOn ? formatFilterBreadcrumb(gf) : "";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-phase-header${group == null ? " task-phase-header--unassigned" : ""}${isDragging ? " dragging" : ""}`}
    >
      <button type="button" className="task-phase-header__collapse" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? "▸" : "▾"}
      </button>
      {group ? (
        <span className="task-drag-handle" {...attributes} {...listeners} title="Drag group">
          ::
        </span>
      ) : (
        <span className="task-drag-handle" style={{ visibility: "hidden" }}>
          ::
        </span>
      )}
      <span
        className="task-phase-header__name"
        title={group && onOpenEdit ? "Double-click to edit group" : undefined}
        onDoubleClick={
          group && onOpenEdit
            ? (e) => {
                e.preventDefault();
                onOpenEdit();
              }
            : undefined
        }
      >
        {group?.name ?? "Unassigned"}
      </span>
      <span className="task-phase-header__count muted" aria-label={`${taskCount} tasks`}>
        {taskCount}
      </span>
      {filterOn ? (
        <span className="task-phase-header__filter" title={breadcrumb} aria-label={`Filter: ${breadcrumb}`}>
          <FilterIcon />
        </span>
      ) : null}
      {group && onRequestDelete ? (
        <button
          type="button"
          className="btn small ghost task-phase-header__delete"
          title="Delete group"
          aria-label={`Delete group ${group.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete();
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

type Props = {
  projectId: number;
  groups: TaskGroup[];
  tasks: Task[];
  listFilter: TaskListFilter;
  /** When set, open the Edit Task modal for this task (e.g. after create). */
  requestOpenTask?: Task | null;
  onRequestOpenTaskConsumed?: () => void;
  onReorder: (payload: TaskReorderPayload) => Promise<void>;
  onReorderGroups: (orderedGroupIds: number[]) => Promise<void>;
  onPatchGroup: (
    groupId: number,
    patch: { name?: string; color?: string | null; filter?: TaskListFilter | null },
  ) => Promise<void>;
  onCreateGroup: (name: string) => Promise<void>;
  onDeleteGroup: (groupId: number) => Promise<void>;
  onPatchTask: (
    taskId: number,
    patch: Record<string, unknown>,
    opts?: PatchTaskOptions,
  ) => Promise<Task | void>;
};

export function TaskBoard({
  projectId,
  groups,
  tasks,
  listFilter,
  requestOpenTask = null,
  onRequestOpenTaskConsumed,
  onReorder,
  onReorderGroups,
  onPatchGroup,
  onCreateGroup,
  onDeleteGroup,
  onPatchTask,
}: Props) {
  const [modalTaskId, setModalTaskId] = useState<number | null>(null);
  const [modalTaskHeld, setModalTaskHeld] = useState<Task | null>(null);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [collapsed, setCollapsed] = useState<Set<number | "none">>(() => new Set());
  const sortStorageKey = storageKeyForProjectTaskSort(projectId);
  const { sortCol, sortDir, setSort } = usePersistedTaskListSort(
    sortStorageKey,
    DEFAULT_PROJECT_TASK_LIST_SORT,
  );
  const [newGroupName, setNewGroupName] = useState("");
  const [pendingGroupDelete, setPendingGroupDelete] = useState<TaskGroup | null>(null);
  const [editGroup, setEditGroup] = useState<TaskGroup | null>(null);
  const [completeBlockMsg, setCompleteBlockMsg] = useState<string | null>(null);

  const rows = useMemo(() => {
    const boardSortCol: SortCol | null = sortCol === "project" ? null : sortCol;
    return buildRows(groups, tasks, listFilter, collapsed, boardSortCol, sortDir);
  }, [groups, tasks, listFilter, collapsed, sortCol, sortDir]);

  const onRequestOpenTaskConsumedRef = useRef(onRequestOpenTaskConsumed);
  onRequestOpenTaskConsumedRef.current = onRequestOpenTaskConsumed;

  useEffect(() => {
    if (requestOpenTask == null) return;
    setModalTaskId(requestOpenTask.id);
    setModalTaskHeld(requestOpenTask);
    onRequestOpenTaskConsumedRef.current?.();
  }, [requestOpenTask]);

  const fromList = modalTaskId != null ? (tasks.find((t) => t.id === modalTaskId) ?? null) : null;
  useEffect(() => {
    if (fromList) setModalTaskHeld(fromList);
  }, [fromList]);
  const modalTask = fromList ?? (modalTaskId != null ? modalTaskHeld : null);

  const sortableIds = useMemo(() => rows.map((r) => r.key), [rows]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const headerSort = (col: SortCol) => {
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 },
    );
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeData = active.data.current as
      | { type?: string; taskId?: number; groupKey?: number | "none"; groupId?: number | null }
      | undefined;
    const overData = over.data.current as
      | { type?: string; taskId?: number; groupKey?: number | "none"; groupId?: number | null }
      | undefined;

    if (activeData?.type === "group" && typeof activeData.groupId === "number") {
      const groupIds = groups.map((g) => g.id);
      const from = groupIds.indexOf(activeData.groupId);
      let to = from;
      if (overData?.type === "group" && typeof overData.groupId === "number") {
        to = groupIds.indexOf(overData.groupId);
      } else if (overData?.type === "task" && typeof overData.groupKey === "number") {
        to = groupIds.indexOf(overData.groupKey);
      }
      if (from < 0 || to < 0 || from === to) return;
      await onReorderGroups(arrayMove(groupIds, from, to));
      return;
    }

    if (activeData?.type === "task" && activeData.taskId != null) {
      const task = tasks.find((t) => t.id === activeData.taskId);
      if (!task || task.parentId != null) {
        // Child reorder among siblings only
        if (!task?.parentId) return;
        const siblings = childrenOf(tasks, task.parentId).map((t) => t.id);
        const oldIndex = siblings.indexOf(task.id);
        let newIndex = oldIndex;
        if (overData?.type === "task" && overData.taskId != null) {
          const overTask = tasks.find((t) => t.id === overData.taskId);
          if (overTask?.parentId === task.parentId) {
            newIndex = siblings.indexOf(overTask.id);
          }
        }
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
        await onReorder({
          orderedTaskIds: arrayMove(siblings, oldIndex, newIndex),
          parentId: task.parentId,
        });
        return;
      }

      const fromKey = activeData.groupKey;
      let toKey: number | "none" | undefined = fromKey;
      if (overData?.type === "group") {
        toKey = overData.groupId ?? "none";
      } else if (overData?.type === "task") {
        toKey = overData.groupKey;
      }
      if (toKey !== fromKey) return;

      const sectionRoots = rows
        .filter(
          (r): r is Extract<FlatRow, { kind: "task" }> =>
            r.kind === "task" && r.groupKey === fromKey && r.depth === 0,
        )
        .map((r) => r.task.id);

      const without = sectionRoots.filter((id) => id !== task.id);
      let insertAt = without.length;
      if (overData?.type === "task" && overData.taskId != null) {
        const idx = without.indexOf(overData.taskId);
        if (idx >= 0) insertAt = idx;
      }
      const next = [...without.slice(0, insertAt), task.id, ...without.slice(insertAt)];
      await onReorder({
        orderedTaskIds: next,
        parentId: null,
      });
    }
  };

  return (
    <>
      <div className="task-list">
        <div className="task-list-header">
          <span className="task-list-header__stripe" />
          <span />
          <span />
          <TaskListSortHeaderBtn
            sorted={sortCol === "number"}
            dir={sortDir}
            onDoubleClick={() => headerSort("number")}
          >
            Number
          </TaskListSortHeaderBtn>
          <TaskListSortHeaderBtn
            sorted={sortCol === "title"}
            dir={sortDir}
            onDoubleClick={() => headerSort("title")}
          >
            Title
          </TaskListSortHeaderBtn>
          <TaskListSortHeaderBtn
            sorted={sortCol === "state"}
            dir={sortDir}
            onDoubleClick={() => headerSort("state")}
          >
            State
          </TaskListSortHeaderBtn>
          <TaskListSortHeaderBtn
            sorted={sortCol === "priority"}
            dir={sortDir}
            onDoubleClick={() => headerSort("priority")}
          >
            Priority
          </TaskListSortHeaderBtn>
          <TaskListSortHeaderBtn
            sorted={sortCol === "dueDate"}
            dir={sortDir}
            onDoubleClick={() => headerSort("dueDate")}
          >
            Due date
          </TaskListSortHeaderBtn>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e)}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            {rows.map((row) => {
              if (row.kind === "group") {
                const groupKey: number | "none" = row.group?.id ?? "none";
                return (
                  <SortableGroupHeader
                    key={row.key}
                    group={row.group}
                    collapsed={collapsed.has(groupKey)}
                    taskCount={row.taskCount}
                    onToggle={() => {
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(groupKey)) next.delete(groupKey);
                        else next.add(groupKey);
                        return next;
                      });
                    }}
                    onOpenEdit={row.group ? () => setEditGroup(row.group) : undefined}
                    onRequestDelete={
                      row.group ? () => setPendingGroupDelete(row.group) : undefined
                    }
                  />
                );
              }
              return (
                <SortableTaskRow
                  key={row.key}
                  task={row.task}
                  depth={row.depth}
                  duplicate={row.duplicate}
                  groupKey={row.groupKey}
                  onOpen={() => setModalTaskId(row.task.id)}
                  onCycleState={() => {
                    const next = nextTaskState(row.task.state);
                    if (next === "complete") {
                      void (async () => {
                        try {
                          const blockers = await fetchOpenDependsOn(row.task.id);
                          if (blockers.length > 0) {
                            setCompleteBlockMsg(formatCompleteBlockMessage(blockers));
                            return;
                          }
                          await onPatchTask(row.task.id, { state: next });
                        } catch (err) {
                          setCompleteBlockMsg((err as Error).message);
                        }
                      })();
                      return;
                    }
                    void onPatchTask(row.task.id, { state: next });
                  }}
                  onPatch={(patch) => void onPatchTask(row.task.id, patch)}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </div>

      <div className="task-phase-add">
        <input
          type="text"
          placeholder="New group name"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newGroupName.trim()) {
              e.preventDefault();
              void onCreateGroup(newGroupName.trim()).then(() => setNewGroupName(""));
            }
          }}
        />
        <button
          type="button"
          className="btn small"
          disabled={!newGroupName.trim()}
          onClick={() => void onCreateGroup(newGroupName.trim()).then(() => setNewGroupName(""))}
        >
          Add group
        </button>
      </div>

      {modalTask ? (
        <ElementShell
          mode="modal"
          entityType="task"
          title={modalTask.title}
          titleLeading={formatTaskNumber(modalTask.number)}
          showType={false}
          accentColor={modalTask.color}
          actions={headerActions}
          open
          onClose={() => {
            setModalTaskId(null);
            setModalTaskHeld(null);
          }}
        >
          <TaskEditorFields
            key={modalTask.id}
            task={modalTask}
            allTasks={tasks}
            onRequestClose={() => {
              setModalTaskId(null);
              setModalTaskHeld(null);
            }}
            onDeleted={() => {
              setModalTaskId(null);
              setModalTaskHeld(null);
            }}
            onHeaderActions={setHeaderActions}
            onOpenTask={(id) => {
              setModalTaskHeld(null);
              setModalTaskId(id);
            }}
            onSavePatch={async (p, opts) => {
              const updated = await onPatchTask(modalTask.id, { ...p }, opts);
              if (updated) setModalTaskHeld(updated);
              return updated;
            }}
          />
        </ElementShell>
      ) : null}

      {editGroup ? (
        <GroupEditModal
          group={editGroup}
          onClose={() => setEditGroup(null)}
          onSave={async (patch) => {
            await onPatchGroup(editGroup.id, patch);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={completeBlockMsg != null}
        title="Cannot mark Complete"
        message={completeBlockMsg ?? ""}
        alertOnly
        confirmLabel="OK"
        onCancel={() => setCompleteBlockMsg(null)}
        onConfirm={() => setCompleteBlockMsg(null)}
      />
      <ConfirmDialog
        open={pendingGroupDelete != null}
        title="Delete group?"
        message={
          pendingGroupDelete
            ? `Delete group “${pendingGroupDelete.name}”? Tasks are not assigned to groups; only this section is removed.`
            : ""
        }
        confirmLabel="Delete"
        onCancel={() => setPendingGroupDelete(null)}
        onConfirm={() => {
          if (!pendingGroupDelete) return;
          const id = pendingGroupDelete.id;
          setPendingGroupDelete(null);
          void onDeleteGroup(id);
        }}
      />
    </>
  );
}
