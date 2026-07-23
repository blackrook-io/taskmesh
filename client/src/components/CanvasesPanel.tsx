import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  closestCorners,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api/client";
import type { Canvas, CanvasSummary } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { CanvasEditor } from "./CanvasEditor";

type Props = { projectId: number };

function SortableCanvasTab({
  canvas,
  active,
  onSelect,
  onRename,
  onRequestDelete,
}: {
  canvas: CanvasSummary;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onRequestDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: canvas.id,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(canvas.title);

  useEffect(() => {
    if (!editing) setDraft(canvas.title);
  }, [canvas.title, editing]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  };

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== canvas.title) onRename(next);
    else setDraft(canvas.title);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`board-tab${active ? " active" : ""}${isDragging ? " is-dragging" : ""}`}
      {...attributes}
      {...listeners}
    >
      {editing ? (
        <input
          className="board-tab__rename"
          value={draft}
          autoFocus
          aria-label="Rename canvas"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraft(canvas.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="board-tab__label"
          onClick={onSelect}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {canvas.title}
        </button>
      )}
      <button
        type="button"
        className="board-tab__close"
        aria-label={`Delete ${canvas.title}`}
        title="Delete canvas"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRequestDelete();
        }}
      >
        ×
      </button>
    </div>
  );
}

export function CanvasesPanel({ projectId }: Props) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CanvasSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [tabOrder, setTabOrder] = useState<number[]>([]);

  const listQuery = useQuery({
    queryKey: ["canvases", projectId],
    queryFn: async () => {
      const res = await apiJson<{ data: CanvasSummary[] }>(`/api/v1/projects/${projectId}/canvases`);
      return res.data;
    },
  });

  const canvases = listQuery.data ?? [];

  useEffect(() => {
    if (!listQuery.data) return;
    setTabOrder(listQuery.data.map((c) => c.id));
  }, [listQuery.data]);

  const orderedCanvases = useMemo(() => {
    const byId = new Map(canvases.map((c) => [c.id, c]));
    const ordered = tabOrder.map((id) => byId.get(id)).filter(Boolean) as CanvasSummary[];
    for (const c of canvases) {
      if (!tabOrder.includes(c.id)) ordered.push(c);
    }
    return ordered;
  }, [canvases, tabOrder]);

  const activeId = selectedId ?? orderedCanvases[0]?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ["canvas", projectId, activeId],
    enabled: activeId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: Canvas }>(`/api/v1/projects/${projectId}/canvases/${activeId}`);
      return res.data;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["canvases", projectId] });
    void qc.invalidateQueries({ queryKey: ["canvas", projectId] });
    void qc.invalidateQueries({ queryKey: ["wiki", projectId] });
  };

  const createCanvas = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: Canvas }>(`/api/v1/projects/${projectId}/canvases`, {
        method: "POST",
        body: JSON.stringify({ title: "Untitled canvas" }),
      });
      return res.data;
    },
    onSuccess: (row) => {
      setSelectedId(row.id);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const renameCanvas = useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) => {
      const res = await apiJson<{ data: Canvas }>(`/api/v1/projects/${projectId}/canvases/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      return res.data;
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => setError(err.message),
  });

  const patchDocument = useMutation({
    mutationFn: async (document: Record<string, unknown>) => {
      if (activeId == null) throw new Error("No canvas selected");
      const res = await apiJson<{ data: Canvas }>(`/api/v1/projects/${projectId}/canvases/${activeId}`, {
        method: "PATCH",
        body: JSON.stringify({ document }),
      });
      return res.data;
    },
    onSuccess: () => {
      setSaveState("saved");
      void qc.invalidateQueries({ queryKey: ["canvases", projectId] });
    },
    onError: (err: Error) => {
      setError(err.message);
      setSaveState("error");
    },
  });

  const reorderCanvases = useMutation({
    mutationFn: async (orderedCanvasIds: number[]) => {
      const res = await apiJson<{ data: CanvasSummary[] }>(
        `/api/v1/projects/${projectId}/canvases/reorder`,
        {
          method: "PATCH",
          body: JSON.stringify({ orderedCanvasIds }),
        },
      );
      return res.data;
    },
    onSuccess: (rows) => {
      void qc.setQueryData(["canvases", projectId], rows);
    },
    onError: (err: Error) => {
      setError(err.message);
      invalidate();
    },
  });

  const deleteCanvas = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/projects/${projectId}/canvases/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      if (pendingDelete && selectedId === pendingDelete.id) setSelectedId(null);
      setPendingDelete(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const tabSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleTabDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tabOrder.indexOf(Number(active.id));
    const newIndex = tabOrder.indexOf(Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(tabOrder, oldIndex, newIndex);
    setTabOrder(next);
    void reorderCanvases.mutateAsync(next);
  };

  return (
    <div className="canvases-panel">
      <div className="board-tabs" role="tablist" aria-label="Project canvases">
        <DndContext sensors={tabSensors} collisionDetection={closestCorners} onDragEnd={handleTabDragEnd}>
          <SortableContext items={tabOrder} strategy={horizontalListSortingStrategy}>
            {orderedCanvases.map((c) => (
              <SortableCanvasTab
                key={c.id}
                canvas={c}
                active={activeId === c.id}
                onSelect={() => setSelectedId(c.id)}
                onRename={(title) => renameCanvas.mutate({ id: c.id, title })}
                onRequestDelete={() => setPendingDelete(c)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <button
          type="button"
          className="board-tab board-tab--add"
          aria-label="Create canvas"
          title="New canvas"
          disabled={createCanvas.isPending}
          onClick={() => createCanvas.mutate()}
        >
          +
        </button>
      </div>

      {error ? (
        <p className="tag-input__error" role="alert">
          {error}
        </p>
      ) : null}

      {listQuery.isLoading ? (
        <p className="muted">Loading canvases…</p>
      ) : activeId == null ? (
        <p className="muted">Create a canvas with + to start a mood board or diagram.</p>
      ) : detailQuery.isLoading ? (
        <p className="muted">Loading canvas…</p>
      ) : detailQuery.data ? (
        <div className="canvases-panel__stage">
          <div className="canvases-panel__status muted">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Save failed"
                  : "Autosave"}
          </div>
          <CanvasEditor
            key={detailQuery.data.id}
            canvasId={detailQuery.data.id}
            title={detailQuery.data.title}
            document={detailQuery.data.document ?? {}}
            onSaveDocument={(document) => {
              setSaveState("saving");
              void patchDocument.mutateAsync(document);
            }}
          />
        </div>
      ) : (
        <p className="muted">Canvas not found.</p>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete canvas?"
        message="This permanently removes the canvas and any wiki TOC entries that point to it."
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteCanvas.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
