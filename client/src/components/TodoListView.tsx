import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson } from "../api/client";
import type { Idea, Project, Task, TodoListDetail, TodoListItem } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ElementShell } from "./shared/ElementShell";

function SortableItem({
  item,
  onToggle,
  onOpen,
  onRemove,
}: {
  item: TodoListItem;
  onToggle: () => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`todo-item${isDragging ? " dragging" : ""}${item.checked ? " is-checked" : ""}`}
    >
      <span className="task-drag-handle" {...attributes} {...listeners} title="Drag to reorder">
        ::
      </span>
      <input
        type="checkbox"
        checked={item.checked}
        aria-label={`Mark ${item.title} ${item.checked ? "incomplete" : "complete"}`}
        onChange={onToggle}
      />
      <button type="button" className="todo-item__title" onClick={onOpen}>
        <span className="todo-item__type muted">{item.entityType}</span>
        {item.title}
      </button>
      <button type="button" className="task-card-dismiss" aria-label="Remove from list" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

type Props = {
  listId: number;
  /** When set, convert-to-task uses this project */
  defaultProjectId?: number | null;
};

export function TodoListView({ listId, defaultProjectId }: Props) {
  const qc = useQueryClient();
  const [openItem, setOpenItem] = useState<TodoListItem | null>(null);
  const [pendingRemove, setPendingRemove] = useState<TodoListItem | null>(null);
  const [addType, setAddType] = useState<"idea" | "task">("idea");
  const [pickId, setPickId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["todo-list", listId],
    queryFn: async () => {
      const res = await apiJson<{ data: TodoListDetail }>(`/api/v1/todo-lists/${listId}`);
      return res.data;
    },
  });

  const ideasQuery = useQuery({
    queryKey: ["ideas"],
    queryFn: async () => {
      const res = await apiJson<{ data: Idea[] }>("/api/v1/ideas");
      return res.data;
    },
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects");
      return res.data;
    },
  });

  const tasksQuery = useQuery({
    queryKey: ["all-tasks-for-todos", defaultProjectId],
    enabled: addType === "task",
    queryFn: async () => {
      const projects = projectsQuery.data ?? (await apiJson<{ data: Project[] }>("/api/v1/projects")).data;
      const scoped = defaultProjectId
        ? projects.filter((p) => p.id === defaultProjectId)
        : projects;
      const all: Task[] = [];
      for (const p of scoped) {
        const res = await apiJson<{ data: Task[] }>(`/api/v1/projects/${p.id}/tasks`);
        all.push(...res.data);
      }
      return all;
    },
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["todo-list", listId] });

  const addItem = useMutation({
    mutationFn: async () => {
      const entityId = Number(pickId);
      const res = await apiJson<{ data: TodoListItem }>(`/api/v1/todo-lists/${listId}/items`, {
        method: "POST",
        body: JSON.stringify({ entityType: addType, entityId }),
      });
      return res.data;
    },
    onSuccess: () => {
      setPickId("");
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const patchItem = useMutation({
    mutationFn: async ({ itemId, checked }: { itemId: number; checked: boolean }) => {
      await apiJson(`/api/v1/todo-lists/${listId}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ checked }),
      });
    },
    onSuccess: () => invalidate(),
  });

  const reorder = useMutation({
    mutationFn: async (orderedItemIds: number[]) => {
      await apiJson(`/api/v1/todo-lists/${listId}/items/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ orderedItemIds }),
      });
    },
    onSuccess: () => invalidate(),
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: number) => {
      await apiJson(`/api/v1/todo-lists/${listId}/items/${itemId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      setPendingRemove(null);
      invalidate();
    },
  });

  const convert = useMutation({
    mutationFn: async ({ itemId, projectId }: { itemId: number; projectId: number }) => {
      const res = await apiJson<{ data: { item: TodoListItem; task: Task } }>(
        `/api/v1/todo-lists/${listId}/items/${itemId}/convert-to-task`,
        { method: "POST", body: JSON.stringify({ projectId }) },
      );
      return res.data;
    },
    onSuccess: (data) => {
      setOpenItem(data.item);
      invalidate();
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const list = detailQuery.data;
  const items = list?.items ?? [];
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(Number(active.id));
    const newIndex = ids.indexOf(Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    await reorder.mutateAsync(next.map((i) => i.id));
  };

  const openIdeaQuery = useQuery({
    queryKey: ["idea", openItem?.entityId],
    enabled: openItem?.entityType === "idea",
    queryFn: async () => {
      const res = await apiJson<{ data: Idea }>(`/api/v1/ideas/${openItem!.entityId}`);
      return res.data;
    },
  });

  const openTaskQuery = useQuery({
    queryKey: ["task-solo", openItem?.entityId],
    enabled: openItem?.entityType === "task",
    queryFn: async () => {
      const projects = (await apiJson<{ data: Project[] }>("/api/v1/projects")).data;
      for (const p of projects) {
        const res = await apiJson<{ data: Task[] }>(`/api/v1/projects/${p.id}/tasks`);
        const found = res.data.find((t) => t.id === openItem!.entityId);
        if (found) return found;
      }
      throw new Error("Task not found");
    },
  });

  if (detailQuery.isLoading) return <p className="muted">Loading list…</p>;
  if (detailQuery.error) return <p role="alert">{(detailQuery.error as Error).message}</p>;
  if (!list) return <p className="muted">List not found.</p>;

  const pickOptions =
    addType === "idea"
      ? (ideasQuery.data ?? []).map((i) => ({ id: i.id, label: i.title }))
      : (tasksQuery.data ?? []).map((t) => ({ id: t.id, label: t.title }));

  const convertProjectId = defaultProjectId ?? projectsQuery.data?.[0]?.id ?? null;

  return (
    <div className="todo-list-view">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e)}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <SortableItem
              key={item.id}
              item={item}
              onToggle={() => patchItem.mutate({ itemId: item.id, checked: !item.checked })}
              onOpen={() => setOpenItem(item)}
              onRemove={() => setPendingRemove(item)}
            />
          ))}
        </SortableContext>
      </DndContext>
      {items.length === 0 ? <p className="muted">No items yet — add an idea or task below.</p> : null}

      <div className="card" style={{ marginTop: "1rem" }}>
        <h3>Add to list</h3>
        <div className="todo-add-row">
          <select value={addType} onChange={(e) => { setAddType(e.target.value as "idea" | "task"); setPickId(""); }}>
            <option value="idea">Idea</option>
            <option value="task">Task</option>
          </select>
          <select value={pickId} onChange={(e) => setPickId(e.target.value)} style={{ flex: 1 }}>
            <option value="">Select…</option>
            {pickOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn primary"
            disabled={!pickId || addItem.isPending}
            onClick={() => addItem.mutate()}
          >
            Add
          </button>
        </div>
        {error ? (
          <p className="tag-input__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {openItem ? (
        <ElementShell
          mode="modal"
          entityType={openItem.entityType === "idea" ? "idea" : "task"}
          title={openItem.title}
          open
          onClose={() => setOpenItem(null)}
          footer={
            <div className="btn-row">
              {openItem.href ? (
                <Link to={openItem.href} className="btn primary" onClick={() => setOpenItem(null)}>
                  Open full record
                </Link>
              ) : null}
              {openItem.entityType === "idea" && convertProjectId != null ? (
                <button
                  type="button"
                  className="btn"
                  disabled={convert.isPending}
                  onClick={() =>
                    convert.mutate({ itemId: openItem.id, projectId: convertProjectId })
                  }
                >
                  Convert to task
                </button>
              ) : null}
              <button type="button" className="btn ghost" onClick={() => setOpenItem(null)}>
                Close
              </button>
            </div>
          }
        >
          {openItem.entityType === "idea" ? (
            openIdeaQuery.isLoading ? (
              <p className="muted">Loading…</p>
            ) : (
              <pre className="todo-preview-body">{openIdeaQuery.data?.body || "No body."}</pre>
            )
          ) : openTaskQuery.isLoading ? (
            <p className="muted">Loading…</p>
          ) : (
            <pre className="todo-preview-body">{openTaskQuery.data?.notes || "No notes."}</pre>
          )}
        </ElementShell>
      ) : null}

      <ConfirmDialog
        open={pendingRemove != null}
        title="Remove from list?"
        message="The idea or task itself is not deleted — only this list entry."
        confirmLabel="Remove"
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          if (pendingRemove) removeItem.mutate(pendingRemove.id);
        }}
      />
    </div>
  );
}
