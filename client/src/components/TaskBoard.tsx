import { useEffect, useMemo, useState } from "react";
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

function TaskFields({
  task,
  phases,
  onSavePatch,
}: {
  task: Task;
  phases: ProjectPhase[];
  onSavePatch: (patch: TaskPatch) => void;
}) {
  const dueLocal = task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16) : "";
  const [notes, setNotes] = useState(task.notes ?? "");

  useEffect(() => {
    setNotes(task.notes ?? "");
  }, [task.notes]);

  return (
    <div className="task-expand">
      <div className="field">
        <label htmlFor={`t-title-${task.id}`}>Title</label>
        <input
          id={`t-title-${task.id}`}
          type="text"
          defaultValue={task.title}
          onBlur={(e) => {
            if (e.target.value !== task.title) onSavePatch({ title: e.target.value });
          }}
        />
      </div>
      <div className="field">
        <label>Notes</label>
        <MarkdownEditor
          value={notes}
          onChange={setNotes}
          height={220}
          placeholder="Task notes…"
          onBlur={(v) => {
            const next = v.trim() ? v : null;
            if (next !== (task.notes ?? "")) onSavePatch({ notes: next });
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
          defaultValue={dueLocal}
          onBlur={(e) => {
            const v = e.target.value;
            if (!v) {
              if (task.dueAt) onSavePatch({ dueAt: null });
              return;
            }
            const iso = new Date(v).toISOString();
            if (iso !== task.dueAt) onSavePatch({ dueAt: iso });
          }}
        />
      </div>
      <div className="field">
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          Color
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <ColorPopover
            color={task.color}
            label="Task color"
            onChange={(c) => onSavePatch({ color: c })}
          />
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {task.color ?? "default"}
          </span>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`t-phase-${task.id}`}>Phase</label>
        <select
          id={`t-phase-${task.id}`}
          defaultValue={String(task.phaseId ?? "")}
          onChange={(e) => {
            const v = e.target.value;
            onSavePatch({ phaseId: v ? Number(v) : null });
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

  const patch = (taskId: number, body: TaskPatch) => void onPatchTask(taskId, { ...body });

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
          <TaskFields task={modalTask} phases={phases} onSavePatch={(p) => patch(modalTask.id, p)} />
        </ElementShell>
      ) : null}
    </>
  );
}
