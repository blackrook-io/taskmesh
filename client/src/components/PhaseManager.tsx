import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useState } from "react";
import { apiJson } from "../api/client";
import type { ProjectPhase } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
  projectId: number;
  phases: ProjectPhase[];
};

function SortablePhaseRow({
  phase,
  onRename,
  onDelete,
}: {
  phase: ProjectPhase;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: phase.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li ref={setNodeRef} style={style} className={`phase-manager__row${isDragging ? " dragging" : ""}`}>
      <span className="task-drag-handle" {...attributes} {...listeners} title="Drag to reorder">
        ::
      </span>
      <input
        type="text"
        className="phase-manager__name"
        defaultValue={phase.name}
        aria-label={`Phase name ${phase.name}`}
        onBlur={(e) => {
          const name = e.target.value.trim();
          if (name && name !== phase.name) onRename(name);
          else e.target.value = phase.name;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <button
        type="button"
        className="btn small ghost"
        aria-label={`Delete phase ${phase.name}`}
        onClick={onDelete}
      >
        ×
      </button>
    </li>
  );
}

export function PhaseManager({ projectId, phases }: Props) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ProjectPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["project-phases", projectId] });
    void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
  };

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: ProjectPhase }>(`/api/v1/projects/${projectId}/phases`, {
        method: "POST",
        body: JSON.stringify({ name: newName.trim() }),
      });
      return res.data;
    },
    onSuccess: () => {
      setNewName("");
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const rename = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiJson<{ data: ProjectPhase }>(
        `/api/v1/projects/${projectId}/phases/${id}`,
        { method: "PATCH", body: JSON.stringify({ name }) },
      );
      return res.data;
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/projects/${projectId}/phases/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      setPendingDelete(null);
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const reorder = useMutation({
    mutationFn: async (orderedPhaseIds: number[]) => {
      const res = await apiJson<{ data: ProjectPhase[] }>(
        `/api/v1/projects/${projectId}/phases/reorder`,
        { method: "PATCH", body: JSON.stringify({ orderedPhaseIds }) },
      );
      return res.data;
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = phases.map((p) => p.id);
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from < 0 || to < 0 || from === to) return;
    void reorder.mutateAsync(arrayMove(ids, from, to));
  };

  return (
    <div className="card phase-manager">
      <h3>Phases</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Optional project phases for tasks. Distinct from Task Groups on the list. Deleting a phase
        clears it from associated tasks.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={phases.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <ul className="phase-manager__list">
            {phases.map((phase) => (
              <SortablePhaseRow
                key={phase.id}
                phase={phase}
                onRename={(name) => rename.mutate({ id: phase.id, name })}
                onDelete={() => setPendingDelete(phase)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="phase-manager__add">
        <input
          type="text"
          placeholder="New phase name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim()) create.mutate();
          }}
        />
        <button
          type="button"
          className="btn small primary"
          disabled={!newName.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          Add phase
        </button>
      </div>
      {error ? (
        <p className="tag-input__error" role="alert">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete phase?"
        message={
          pendingDelete
            ? `Tasks currently in “${pendingDelete.name}” will have Phase cleared.`
            : "Associated tasks will have Phase cleared."
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
