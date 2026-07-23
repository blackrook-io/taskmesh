import { useMemo } from "react";
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

function SortableRow({
  task,
  phases,
  expanded,
  onToggle,
  onSavePatch,
  onDelete,
}: {
  task: Task;
  phases: ProjectPhase[];
  expanded: boolean;
  onToggle: () => void;
  onSavePatch: (patch: TaskPatch) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const barColor = task.color?.trim() || "var(--accent)";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-row${isDragging ? " dragging" : ""}`}
    >
      <span className="task-drag-handle" {...attributes} {...listeners} title="Drag to reorder">
        ::
      </span>
      <div className="task-color-bar" style={{ background: barColor }} aria-hidden />
      <div className="task-body">
        <div className="task-title-line">
          <strong style={{ flex: 1 }}>{task.title}</strong>
          <span className="muted">{phaseNameFor(phases, task.phaseId)}</span>
          <button type="button" className="btn small ghost" onClick={onToggle}>
            {expanded ? "Collapse" : "Expand"}
          </button>
          <button type="button" className="btn small danger" onClick={onDelete}>
            Delete
          </button>
        </div>
        {expanded ? (
          <TaskExpanded task={task} phases={phases} onSavePatch={onSavePatch} />
        ) : null}
      </div>
    </div>
  );
}

function TaskExpanded({
  task,
  phases,
  onSavePatch,
}: {
  task: Task;
  phases: ProjectPhase[];
  onSavePatch: (patch: TaskPatch) => void;
}) {
  const dueLocal = task.dueAt
    ? new Date(task.dueAt).toISOString().slice(0, 16)
    : "";

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
        <label htmlFor={`t-notes-${task.id}`}>Notes</label>
        <textarea
          id={`t-notes-${task.id}`}
          className="raw-md"
          defaultValue={task.notes ?? ""}
          onBlur={(e) => {
            const v = e.target.value || null;
            if (v !== (task.notes ?? "")) onSavePatch({ notes: v });
          }}
        />
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
        <label htmlFor={`t-color-${task.id}`}>Color (CSS)</label>
        <input
          id={`t-color-${task.id}`}
          type="text"
          placeholder="#7dd87d"
          defaultValue={task.color ?? ""}
          onBlur={(e) => {
            const v = e.target.value.trim() || null;
            if (v !== (task.color ?? "")) onSavePatch({ color: v });
          }}
        />
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

type Props = {
  phases: ProjectPhase[];
  tasks: Task[];
  expandedId: number | null;
  setExpandedId: (id: number | null) => void;
  onReorder: (orderedTaskIds: number[]) => Promise<void>;
  onPatchTask: (taskId: number, patch: Record<string, unknown>) => Promise<void>;
  onDeleteTask: (taskId: number) => Promise<void>;
};

export function TaskBoard({
  phases,
  tasks,
  expandedId,
  setExpandedId,
  onReorder,
  onPatchTask,
  onDeleteTask,
}: Props) {
  const ordered = useMemo(() => flattenTasks(phases, tasks), [phases, tasks]);
  const ids = useMemo(() => ordered.map((t) => t.id), [ordered]);

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
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e)}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ordered.map((task) => (
          <SortableRow
            key={task.id}
            task={task}
            phases={phases}
            expanded={expandedId === task.id}
            onToggle={() => setExpandedId(expandedId === task.id ? null : task.id)}
            onSavePatch={(patch) =>
              void onPatchTask(task.id, {
                ...patch,
              })
            }
            onDelete={() => void onDeleteTask(task.id)}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}
