import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { useUndoStack } from "../hooks/useUndoStack";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATES,
  TASK_STATE_LABELS,
  formatTaskNumber,
  nextTaskState,
  type TaskPriority,
  type TaskState,
} from "../lib/taskFields";
import type { ProjectPhase, Task } from "../types";
import { ColorPopover } from "./shared/ColorPopover";
import { ElementShell } from "./shared/ElementShell";
import { MarkdownEditor } from "./shared/MarkdownEditor";
import { TagInput } from "./shared/TagInput";

export type TaskReorderPayload = {
  orderedTaskIds: number[];
  parentId?: number | null;
  phaseId?: number | null;
};

type SortCol = "number" | "title" | "state" | "priority" | "dueDate";

type TaskPatch = {
  title?: string;
  notes?: string | null;
  dueDate?: string | null;
  color?: string | null;
  phaseId?: number | null;
  parentId?: number | null;
  state?: TaskState;
  priority?: TaskPriority;
};

type TaskSnapshot = {
  title: string;
  notes: string;
  dueDate: string | null;
  color: string | null;
  phaseId: number | null;
  state: TaskState;
  priority: TaskPriority;
};

function taskDue(task: Task): string | null {
  return task.dueDate ?? (task.dueAt ? task.dueAt.slice(0, 10) : null);
}

function snapshotFromTask(task: Task): TaskSnapshot {
  return {
    title: task.title,
    notes: task.notes ?? "",
    dueDate: taskDue(task),
    color: task.color,
    phaseId: task.phaseId,
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
    in_progress: 1,
    on_hold: 2,
    complete: 3,
    canceled: 4,
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
  const unassigned = roots.filter((t) => t.phaseId == null);
  if (unassigned.length > 0 || orderedPhases.length === 0) {
    pushPhase(null, "none");
  }
  return rows;
}

function StateCheckbox({
  state,
  onCycle,
}: {
  state: TaskState;
  onCycle: () => void;
}) {
  const glyph =
    state === "in_progress"
      ? "/"
      : state === "complete"
        ? "✓"
        : state === "canceled"
          ? "X"
          : state === "on_hold"
            ? "-"
            : "";
  const cls =
    state === "in_progress"
      ? "task-state-cb task-state-cb--progress"
      : state === "complete"
        ? "task-state-cb task-state-cb--done"
        : state === "canceled"
          ? "task-state-cb task-state-cb--canceled"
          : state === "on_hold"
            ? "task-state-cb task-state-cb--hold"
            : "task-state-cb";
  return (
    <button
      type="button"
      className={cls}
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
  phases,
  allTasks,
  onSavePatch,
  onRequestClose,
  onHeaderActions,
}: {
  task: Task;
  phases: ProjectPhase[];
  allTasks?: Task[];
  onSavePatch: (patch: TaskPatch) => Promise<void> | void;
  onRequestClose?: () => void;
  /** Renders controls into the modal header (left of Close). */
  onHeaderActions?: (node: ReactNode) => void;
}) {
  const initial = snapshotFromTask(task);
  const { push, undo, reset, canUndo, revision } = useUndoStack(initial);
  const [title, setTitle] = useState(initial.title);
  const [notes, setNotes] = useState(initial.notes);
  const [dueLocal, setDueLocal] = useState(initial.dueDate ?? "");
  const [color, setColor] = useState(initial.color);
  const [phaseId, setPhaseId] = useState(initial.phaseId);
  const [state, setState] = useState(initial.state);
  const [priority, setPriority] = useState(initial.priority);
  const [saveError, setSaveError] = useState<string | null>(null);

  const children = (allTasks ?? []).filter((t) => t.parentId === task.id);

  useEffect(() => {
    const snap = snapshotFromTask(task);
    reset(snap);
    setTitle(snap.title);
    setNotes(snap.notes);
    setDueLocal(snap.dueDate ?? "");
    setColor(snap.color);
    setPhaseId(snap.phaseId);
    setState(snap.state);
    setPriority(snap.priority);
    setSaveError(null);
  }, [task.id, reset]);

  const currentSnap = (): TaskSnapshot => ({
    title,
    notes,
    dueDate: dueLocal || null,
    color,
    phaseId,
    state,
    priority,
  });

  const applySnap = (snap: TaskSnapshot) => {
    setTitle(snap.title);
    setNotes(snap.notes);
    setDueLocal(snap.dueDate ?? "");
    setColor(snap.color);
    setPhaseId(snap.phaseId);
    setState(snap.state);
    setPriority(snap.priority);
  };

  const commit = async (previous: TaskSnapshot, patch: TaskPatch) => {
    push(previous);
    try {
      await onSavePatch(patch);
      setSaveError(null);
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  const handleUndo = async () => {
    const restored = undo();
    applySnap(restored);
    try {
      await onSavePatch({
        title: restored.title,
        notes: restored.notes.trim() ? restored.notes : null,
        dueDate: restored.dueDate,
        color: restored.color,
        phaseId: restored.phaseId,
        state: restored.state,
        priority: restored.priority,
      });
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
        onRequestClose?.();
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
    <div className="task-expand">
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
          <label htmlFor={`t-phase-${task.id}`}>Phase</label>
          <select
            id={`t-phase-${task.id}`}
            value={phaseId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const nextPhase = v ? Number(v) : null;
              const prev = { ...currentSnap(), phaseId };
              setPhaseId(nextPhase);
              void commit(prev, { phaseId: nextPhase });
            }}
          >
            <option value="">Unassigned</option>
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
          <label htmlFor={`t-due-${task.id}`}>Date</label>
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
        <label>Notes</label>
        <MarkdownEditor
          key={`${task.id}-${revision}-notes`}
          value={notes}
          onChange={setNotes}
          fill
          placeholder="Task notes…"
          onBlur={(v) => {
            setNotes(v);
            const normalized = v.trim() ? v : null;
            if (normalized !== (task.notes ?? "")) {
              void commit({ ...currentSnap(), notes: task.notes ?? "" }, { notes: normalized });
            }
          }}
        />
      </div>
      <div className="field field--tags-below task-editor-tags-row">
        <span className="task-editor-hint muted">
          Autosaves on blur · Esc closes · Ctrl+Z undoes
        </span>
        <TagInput entityType="task" entityId={task.id} />
      </div>
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
      <span className="task-list-row__title">{task.title}</span>
      <span className="task-list-row__state muted">{TASK_STATE_LABELS[task.state]}</span>
      <select
        className="task-list-row__priority"
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
  phaseKey,
  collapsed,
  onToggle,
  onRename,
}: {
  phase: ProjectPhase | null;
  phaseKey: number | "none";
  collapsed: boolean;
  onToggle: () => void;
  onRename?: (name: string) => void;
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
  const [name, setName] = useState(phase?.name ?? "Unassigned");

  useEffect(() => {
    setName(phase?.name ?? "Unassigned");
  }, [phase?.name]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-phase-header${isDragging ? " dragging" : ""}`}
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
      {phase && onRename ? (
        <input
          className="task-phase-header__name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== phase.name) onRename(name.trim());
          }}
        />
      ) : (
        <span className="task-phase-header__name">{name}</span>
      )}
    </div>
  );
}

type Props = {
  projectId: number;
  phases: ProjectPhase[];
  tasks: Task[];
  onReorder: (payload: TaskReorderPayload) => Promise<void>;
  onReorderPhases: (orderedPhaseIds: number[]) => Promise<void>;
  onRenamePhase: (phaseId: number, name: string) => Promise<void>;
  onCreatePhase: (name: string) => Promise<void>;
  onPatchTask: (taskId: number, patch: Record<string, unknown>) => Promise<void>;
  onDeleteTask: (taskId: number) => Promise<void>;
};

export function TaskBoard({
  phases,
  tasks,
  onReorder,
  onReorderPhases,
  onRenamePhase,
  onCreatePhase,
  onPatchTask,
  onDeleteTask: _onDeleteTask,
}: Props) {
  const [modalTaskId, setModalTaskId] = useState<number | null>(null);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [collapsed, setCollapsed] = useState<Set<number | "none">>(() => new Set());
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [newPhaseName, setNewPhaseName] = useState("");

  const rows = useMemo(
    () => buildRows(phases, tasks, collapsed, sortCol, sortDir),
    [phases, tasks, collapsed, sortCol, sortDir],
  );

  const modalTask = modalTaskId != null ? (tasks.find((t) => t.id === modalTaskId) ?? null) : null;

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
    if (sortCol === col) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortCol(col);
      setSortDir(1);
    }
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

      <div className="task-list">
        <div className="task-list-header">
          <span className="task-list-header__stripe" />
          <span />
          <span />
          <button type="button" className="task-list-header__btn" onDoubleClick={() => headerSort("number")}>
            Number
          </button>
          <button type="button" className="task-list-header__btn" onDoubleClick={() => headerSort("title")}>
            Title
          </button>
          <button type="button" className="task-list-header__btn" onDoubleClick={() => headerSort("state")}>
            State
          </button>
          <button type="button" className="task-list-header__btn" onDoubleClick={() => headerSort("priority")}>
            Priority
          </button>
          <button type="button" className="task-list-header__btn" onDoubleClick={() => headerSort("dueDate")}>
            Date
          </button>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e)}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            {rows.map((row) => {
              if (row.kind === "phase") {
                const phaseKey: number | "none" = row.phase?.id ?? "none";
                return (
                  <SortablePhaseHeader
                    key={row.key}
                    phase={row.phase}
                    phaseKey={phaseKey}
                    collapsed={collapsed.has(phaseKey)}
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
                  />
                );
              }
              return (
                <SortableTaskRow
                  key={row.key}
                  task={row.task}
                  depth={row.depth}
                  onOpen={() => setModalTaskId(row.task.id)}
                  onCycleState={() =>
                    void onPatchTask(row.task.id, { state: nextTaskState(row.task.state) })
                  }
                  onPatch={(patch) => void onPatchTask(row.task.id, patch)}
                />
              );
            })}
          </SortableContext>
        </DndContext>
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
          onClose={() => setModalTaskId(null)}
        >
          <TaskEditorFields
            key={modalTask.id}
            task={modalTask}
            phases={phases}
            allTasks={tasks}
            onRequestClose={() => setModalTaskId(null)}
            onHeaderActions={setHeaderActions}
            onSavePatch={(p) => onPatchTask(modalTask.id, { ...p })}
          />
        </ElementShell>
      ) : null}
    </>
  );
}
