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
  TASK_STATES,
  TASK_STATE_LABELS,
  taskPriorityClass,
  taskStateClass,
  formatTaskNumber,
  nextTaskState,
  type TaskPriority,
  type TaskState,
} from "../lib/taskFields";
import type { Project, ProjectPhase, Task } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ColorPopover } from "./shared/ColorPopover";
import { ElementShell } from "./shared/ElementShell";
import { MarkdownEditor } from "./shared/MarkdownEditor";
import { RowTagChips } from "./shared/RowTagChips";
import { TagInput } from "./shared/TagInput";
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
  const stateRank: Record<TaskState, number> = {
    new: 0,
    ready: 1,
    in_progress: 2,
    on_hold: 3,
    complete: 4,
    canceled: 5,
  };
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
  | { kind: "phase"; phase: ProjectPhase | null; key: string }
  | { kind: "task"; task: Task; depth: number; key: string };

function buildRows(
  phases: ProjectPhase[],
  tasks: Task[],
  collapsed: Set<number | "none">,
  sortCol: SortCol | null,
  sortDir: 1 | -1,
): FlatRow[] {
  const orderedPhases = [...phases].sort((a, b) => a.sortOrder - b.sortOrder);
  const roots = tasks.filter((t) => t.parentId == null);
  const rows: FlatRow[] = [];

  const pushPhase = (phase: ProjectPhase | null, phaseKey: number | "none") => {
    rows.push({
      kind: "phase",
      phase,
      key: `phase-${phaseKey}`,
    });
    if (collapsed.has(phaseKey)) return;
    const phaseRoots = sortRoots(
      roots.filter((t) => (t.phaseId ?? null) === (phase?.id ?? null)),
      sortCol,
      sortDir,
    );
    const pushTree = (t: Task, depth: number) => {
      rows.push({ kind: "task", task: t, depth, key: `task-${t.id}` });
      for (const c of childrenOf(tasks, t.id)) {
        pushTree(c, depth + 1);
      }
    };
    for (const root of phaseRoots) {
      pushTree(root, 0);
    }
  };

  for (const ph of orderedPhases) {
    pushPhase(ph, ph.id);
  }
  // Always show Unassigned so dump-from-delete and zero-phase projects are visible.
  pushPhase(null, "none");
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
        : state === "complete"
          ? "✓"
          : state === "canceled"
            ? "X"
            : state === "on_hold"
              ? "-"
              : "";
  return (
    <button
      type="button"
      className={taskStateClass("task-state-cb", state)}
      title={`${TASK_STATE_LABELS[state]} — click to cycle`}
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
  phases: phasesProp,
  allTasks,
  onSavePatch,
  onRequestClose,
  onDeleted,
  onHeaderActions,
  onOpenTask,
}: {
  task: Task;
  phases: ProjectPhase[];
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

  const phasesQuery = useQuery({
    queryKey: ["phases", projectId],
    enabled: projectId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: ProjectPhase[] }>(
        `/api/v1/projects/${projectId}/phases`,
      );
      return res.data;
    },
  });

  const phases =
    projectId == null
      ? []
      : (phasesQuery.data ?? (projectId === task.projectId ? phasesProp : []));

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
          <label htmlFor={`t-phase-${task.id}`}>Phase</label>
          <select
            id={`t-phase-${task.id}`}
            value={phaseId ?? ""}
            disabled={projectId == null}
            onChange={(e) => {
              const v = e.target.value;
              const nextPhase = v ? Number(v) : null;
              const prev = { ...currentSnap(), phaseId };
              setPhaseId(nextPhase);
              void commit(prev, { phaseId: nextPhase });
            }}
          >
            <option value="">{projectId == null ? "—" : "Unassigned"}</option>
            {phases.map((p) => (
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
            {TASK_STATES.map((s) => (
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
        <label>Description</label>
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
      {deleteError ? (
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
        message="This cannot be undone."
        warning={
          children.length > 0
            ? `This task has ${children.length} child task${children.length === 1 ? "" : "s"}. They will be unlinked, not deleted.`
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
          deleting || (deleteOpen && allTasks === undefined && childrenQuery.isFetching)
        }
        onCancel={() => {
          if (deleting) return;
          setDeleteOpen(false);
          setDeleteError(null);
        }}
        onConfirm={() => {
          if (deleting) return;
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
  onOpen,
  onCycleState,
  onPatch,
}: {
  task: Task;
  depth: number;
  onOpen: () => void;
  onCycleState: () => void;
  onPatch: (patch: TaskPatch) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `task-${task.id}`,
    data: { type: "task", taskId: task.id, parentId: task.parentId, phaseId: task.phaseId },
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

function SortablePhaseHeader({
  phase,
  collapsed,
  taskCount,
  onToggle,
  onRename,
  onRequestDelete,
}: {
  phase: ProjectPhase | null;
  collapsed: boolean;
  taskCount: number;
  onToggle: () => void;
  onRename?: (name: string) => void;
  onRequestDelete?: () => void;
}) {
  const sortableId = phase ? `phase-${phase.id}` : "phase-none";
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: { type: "phase", phaseId: phase?.id ?? null },
    disabled: phase == null,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(phase?.name ?? "Unassigned");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(phase?.name ?? "Unassigned");
  }, [phase?.name]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitRename = () => {
    if (!phase || !onRename) {
      setEditing(false);
      return;
    }
    const next = name.trim();
    if (!next) {
      setName(phase.name);
      setEditing(false);
      return;
    }
    if (next !== phase.name) onRename(next);
    setEditing(false);
  };

  const cancelRename = () => {
    setName(phase?.name ?? "Unassigned");
    setEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-phase-header${phase == null ? " task-phase-header--unassigned" : ""}${isDragging ? " dragging" : ""}`}
    >
      <button type="button" className="task-phase-header__collapse" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? "▸" : "▾"}
      </button>
      {phase ? (
        <span className="task-drag-handle" {...attributes} {...listeners} title="Drag phase">
          ::
        </span>
      ) : (
        <span className="task-drag-handle" style={{ visibility: "hidden" }}>
          ::
        </span>
      )}
      {phase && onRename && editing ? (
        <input
          ref={inputRef}
          className="task-phase-header__name"
          value={name}
          aria-label="Phase name"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelRename();
            }
          }}
        />
      ) : (
        <span
          className="task-phase-header__name"
          title={phase && onRename ? "Double-click to rename" : undefined}
          onDoubleClick={
            phase && onRename
              ? (e) => {
                  e.preventDefault();
                  setEditing(true);
                }
              : undefined
          }
        >
          {phase?.name ?? "Unassigned"}
        </span>
      )}
      <span className="task-phase-header__count muted" aria-label={`${taskCount} tasks`}>
        {taskCount}
      </span>
      {phase && onRequestDelete ? (
        <button
          type="button"
          className="btn small ghost task-phase-header__delete"
          title="Delete phase"
          aria-label={`Delete phase ${phase.name}`}
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
  phases: ProjectPhase[];
  tasks: Task[];
  /** When set, open the Edit Task modal for this task (e.g. after create). */
  requestOpenTask?: Task | null;
  onRequestOpenTaskConsumed?: () => void;
  onReorder: (payload: TaskReorderPayload) => Promise<void>;
  onReorderPhases: (orderedPhaseIds: number[]) => Promise<void>;
  onRenamePhase: (phaseId: number, name: string) => Promise<void>;
  onCreatePhase: (name: string) => Promise<void>;
  onDeletePhase: (phaseId: number) => Promise<void>;
  onPatchTask: (
    taskId: number,
    patch: Record<string, unknown>,
    opts?: PatchTaskOptions,
  ) => Promise<Task | void>;
};

export function TaskBoard({
  projectId,
  phases,
  tasks,
  requestOpenTask = null,
  onRequestOpenTaskConsumed,
  onReorder,
  onReorderPhases,
  onRenamePhase,
  onCreatePhase,
  onDeletePhase,
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
  const [newPhaseName, setNewPhaseName] = useState("");
  const [pendingPhaseDelete, setPendingPhaseDelete] = useState<ProjectPhase | null>(null);
  const [completeBlockMsg, setCompleteBlockMsg] = useState<string | null>(null);

  const rows = useMemo(() => {
    const boardSortCol: SortCol | null = sortCol === "project" ? null : sortCol;
    return buildRows(phases, tasks, collapsed, boardSortCol, sortDir);
  }, [phases, tasks, collapsed, sortCol, sortDir]);

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

  const sortableIds = useMemo(() => {
    const ids: string[] = [];
    for (const r of rows) {
      if (r.kind === "phase") ids.push(r.key);
      else ids.push(r.key);
    }
    return ids;
  }, [rows]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const headerSort = (col: SortCol) => {
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 },
    );
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeData = active.data.current as { type?: string; taskId?: number; phaseId?: number | null } | undefined;
    const overData = over.data.current as { type?: string; taskId?: number; phaseId?: number | null } | undefined;

    if (activeData?.type === "phase" && typeof activeData.phaseId === "number") {
      const phaseIds = phases.map((p) => p.id);
      const from = phaseIds.indexOf(activeData.phaseId);
      let to = from;
      if (overData?.type === "phase" && typeof overData.phaseId === "number") {
        to = phaseIds.indexOf(overData.phaseId);
      }
      if (from < 0 || to < 0 || from === to) return;
      await onReorderPhases(arrayMove(phaseIds, from, to));
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

      let targetPhaseId: number | null | undefined = task.phaseId;
      if (overData?.type === "phase") {
        targetPhaseId = overData.phaseId ?? null;
      } else if (overData?.type === "task" && overData.taskId != null) {
        const overTask = tasks.find((t) => t.id === overData.taskId);
        if (overTask) targetPhaseId = overTask.phaseId;
      }

      const rootsInPhase = tasks
        .filter((t) => t.parentId == null && (t.phaseId ?? null) === (targetPhaseId ?? null))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
        .map((t) => t.id);

      const without = rootsInPhase.filter((id) => id !== task.id);
      let insertAt = without.length;
      if (overData?.type === "task" && overData.taskId != null) {
        const idx = without.indexOf(overData.taskId);
        if (idx >= 0) insertAt = idx;
      }
      const next = [...without.slice(0, insertAt), task.id, ...without.slice(insertAt)];
      await onReorder({
        orderedTaskIds: next,
        parentId: null,
        phaseId: targetPhaseId ?? null,
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
              if (row.kind === "phase") {
                const phaseKey: number | "none" = row.phase?.id ?? "none";
                const taskCount = tasks.filter(
                  (t) => t.parentId == null && (t.phaseId ?? null) === (row.phase?.id ?? null),
                ).length;
                return (
                  <SortablePhaseHeader
                    key={row.key}
                    phase={row.phase}
                    collapsed={collapsed.has(phaseKey)}
                    taskCount={taskCount}
                    onToggle={() => {
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(phaseKey)) next.delete(phaseKey);
                        else next.add(phaseKey);
                        return next;
                      });
                    }}
                    onRename={
                      row.phase
                        ? (name) => void onRenamePhase(row.phase!.id, name)
                        : undefined
                    }
                    onRequestDelete={
                      row.phase ? () => setPendingPhaseDelete(row.phase) : undefined
                    }
                  />
                );
              }
              return (
                <SortableTaskRow
                  key={row.key}
                  task={row.task}
                  depth={row.depth}
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
          placeholder="New phase name"
          value={newPhaseName}
          onChange={(e) => setNewPhaseName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newPhaseName.trim()) {
              e.preventDefault();
              void onCreatePhase(newPhaseName.trim()).then(() => setNewPhaseName(""));
            }
          }}
        />
        <button
          type="button"
          className="btn small"
          disabled={!newPhaseName.trim()}
          onClick={() => void onCreatePhase(newPhaseName.trim()).then(() => setNewPhaseName(""))}
        >
          Add phase
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
            phases={phases}
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
        open={pendingPhaseDelete != null}
        title="Delete phase?"
        message={
          pendingPhaseDelete
            ? (() => {
                const n = tasks.filter((t) => t.phaseId === pendingPhaseDelete.id).length;
                return n === 0
                  ? `Delete phase “${pendingPhaseDelete.name}”? It has no tasks.`
                  : `Delete phase “${pendingPhaseDelete.name}”? ${n} task${n === 1 ? "" : "s"} will move to Unassigned.`;
              })()
            : ""
        }
        confirmLabel="Delete"
        onCancel={() => setPendingPhaseDelete(null)}
        onConfirm={() => {
          if (!pendingPhaseDelete) return;
          const id = pendingPhaseDelete.id;
          setPendingPhaseDelete(null);
          void onDeletePhase(id);
        }}
      />
    </>
  );
}
