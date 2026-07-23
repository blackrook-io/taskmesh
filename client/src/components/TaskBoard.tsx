import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useUndoStack } from "../hooks/useUndoStack";
import type { ProjectPhase, Task } from "../types";
import { ColorPopover } from "./shared/ColorPopover";
import { ElementShell } from "./shared/ElementShell";
import { MarkdownEditor } from "./shared/MarkdownEditor";
import { TagInput } from "./shared/TagInput";

function flattenTasks(phases: ProjectPhase[], tasks: Task[]): Task[] {
  const orderedPhases = [...phases].sort((a, b) => a.sortOrder - b.sortOrder);
  const byPhase = new Map<number | "none", Task[]>();
  for (const t of tasks) {
    const key = t.phaseId ?? "none";
    const arr = byPhase.get(key) ?? [];
    arr.push(t);
    byPhase.set(key, arr);
  }
  for (const arr of byPhase.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }
  const out: Task[] = [];
  for (const ph of orderedPhases) {
    out.push(...(byPhase.get(ph.id) ?? []));
  }
  const seen = new Set(out.map((t) => t.id));
  for (const t of tasks) {
    if (!seen.has(t.id)) out.push(t);
  }
  return out;
}

function phaseNameFor(phases: ProjectPhase[], phaseId: number | null): string {
  if (phaseId == null) return "Unassigned";
  return phases.find((p) => p.id === phaseId)?.name ?? "Phase";
}

type TaskPatch = {
  title?: string;
  notes?: string | null;
  dueAt?: string | null;
  color?: string | null;
  phaseId?: number | null;
};

type TaskSnapshot = {
  title: string;
  notes: string;
  dueAt: string | null;
  color: string | null;
  phaseId: number | null;
};

function snapshotFromTask(task: Task): TaskSnapshot {
  return {
    title: task.title,
    notes: task.notes ?? "",
    dueAt: task.dueAt,
    color: task.color,
    phaseId: task.phaseId,
  };
}

function dueToLocal(dueAt: string | null): string {
  return dueAt ? new Date(dueAt).toISOString().slice(0, 16) : "";
}

export function TaskEditorFields({
  task,
  phases,
  onSavePatch,
  onRequestClose,
}: {
  task: Task;
  phases: ProjectPhase[];
  onSavePatch: (patch: TaskPatch) => Promise<void> | void;
  onRequestClose?: () => void;
}) {
  const initial = snapshotFromTask(task);
  const { push, undo, reset, canUndo, revision } = useUndoStack(initial);
  const [title, setTitle] = useState(initial.title);
  const [notes, setNotes] = useState(initial.notes);
  const [dueLocal, setDueLocal] = useState(dueToLocal(initial.dueAt));
  const [color, setColor] = useState(initial.color);
  const [phaseId, setPhaseId] = useState(initial.phaseId);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const snap = snapshotFromTask(task);
    reset(snap);
    setTitle(snap.title);
    setNotes(snap.notes);
    setDueLocal(dueToLocal(snap.dueAt));
    setColor(snap.color);
    setPhaseId(snap.phaseId);
    setSaveError(null);
  }, [task.id, reset]);

  const currentSnap = (): TaskSnapshot => ({
    title,
    notes,
    dueAt: dueLocal ? new Date(dueLocal).toISOString() : null,
    color,
    phaseId,
  });

  const applySnap = (snap: TaskSnapshot) => {
    setTitle(snap.title);
    setNotes(snap.notes);
    setDueLocal(dueToLocal(snap.dueAt));
    setColor(snap.color);
    setPhaseId(snap.phaseId);
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
        dueAt: restored.dueAt,
        color: restored.color,
        phaseId: restored.phaseId,
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

  return (
    <div className="task-expand">
      <div className="btn-row" style={{ marginBottom: "0.75rem" }}>
        <button
          type="button"
          className="btn small ghost"
          disabled={!canUndo}
          onClick={() => void handleUndo()}
          title="Undo last change (Ctrl+Z)"
        >
          Undo
        </button>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          Autosaves on blur · Esc closes · Ctrl+Z undoes (outside notes editor)
        </span>
      </div>
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
      <div className="field">
        <label>Notes</label>
        <MarkdownEditor
          key={`${task.id}-${revision}-notes`}
          value={notes}
          onChange={setNotes}
          height={220}
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
      <div className="field field--tags-below">
        <TagInput entityType="task" entityId={task.id} />
      </div>
      <div className="field">
        <label htmlFor={`t-due-${task.id}`}>Due</label>
        <input
          id={`t-due-${task.id}`}
          type="datetime-local"
          value={dueLocal}
          onChange={(e) => setDueLocal(e.target.value)}
          onBlur={() => {
            const iso = dueLocal ? new Date(dueLocal).toISOString() : null;
            if (iso !== task.dueAt) {
              void commit({ ...currentSnap(), dueAt: task.dueAt }, { dueAt: iso });
            }
          }}
        />
      </div>
      <div className="field">
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          Color
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <ColorPopover
            color={color}
            label="Task color"
            onChange={(c) => {
              const prev = { ...currentSnap(), color };
              setColor(c);
              void commit(prev, { color: c });
            }}
          />
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {color ?? "default"}
          </span>
        </div>
      </div>
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
      {saveError ? (
        <p role="alert" className="tag-input__error">
          {saveError}
        </p>
      ) : null}
    </div>
  );
}

function SortableRow({
  task,
  phases,
  onOpenModal,
  onDelete,
}: {
  task: Task;
  phases: ProjectPhase[];
  onOpenModal: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    marginBottom: "0.5rem",
  };

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "dragging" : undefined}>
      <div style={{ display: "flex", alignItems: "stretch", gap: "0.25rem" }}>
        <span className="task-drag-handle" {...attributes} {...listeners} title="Drag to reorder">
          ::
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ElementShell
            mode="card"
            entityType="task"
            title={task.title}
            accentColor={task.color}
            onTitleClick={onOpenModal}
            cornerAction={
              <button
                type="button"
                className="task-card-dismiss"
                aria-label={`Delete ${task.title}`}
                title="Delete task"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                ×
              </button>
            }
            actions={
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                {phaseNameFor(phases, task.phaseId)}
              </span>
            }
          />
        </div>
      </div>
    </div>
  );
}

type Props = {
  phases: ProjectPhase[];
  tasks: Task[];
  onReorder: (orderedTaskIds: number[]) => Promise<void>;
  onPatchTask: (taskId: number, patch: Record<string, unknown>) => Promise<void>;
  onDeleteTask: (taskId: number) => Promise<void>;
};

export function TaskBoard({ phases, tasks, onReorder, onPatchTask, onDeleteTask }: Props) {
  const [modalTaskId, setModalTaskId] = useState<number | null>(null);
  const ordered = useMemo(() => flattenTasks(phases, tasks), [phases, tasks]);
  const ids = useMemo(() => ordered.map((t) => t.id), [ordered]);
  const modalTask = modalTaskId != null ? (tasks.find((t) => t.id === modalTaskId) ?? null) : null;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(Number(active.id));
    const newIndex = ids.indexOf(Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ordered, oldIndex, newIndex);
    await onReorder(next.map((t) => t.id));
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e)}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ordered.map((task) => (
            <SortableRow
              key={task.id}
              task={task}
              phases={phases}
              onOpenModal={() => setModalTaskId(task.id)}
              onDelete={() => void onDeleteTask(task.id)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {modalTask ? (
        <ElementShell
          mode="modal"
          entityType="task"
          title={modalTask.title}
          accentColor={modalTask.color}
          open
          onClose={() => setModalTaskId(null)}
        >
          <TaskEditorFields
            key={modalTask.id}
            task={modalTask}
            phases={phases}
            onRequestClose={() => setModalTaskId(null)}
            onSavePatch={(p) => onPatchTask(modalTask.id, { ...p })}
          />
        </ElementShell>
      ) : null}
    </>
  );
}
