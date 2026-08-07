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
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { apiJson } from "../api/client";
import { formatTaskNumber } from "../lib/taskFields";
import type { Idea, Project, ProjectPhase, Task, TodoListDetail, TodoListItem } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { TaskEditorFields } from "./TaskBoard";
import { ElementShell } from "./shared/ElementShell";
import { MarkdownEditor } from "./shared/MarkdownEditor";
import { TagInput } from "./shared/TagInput";

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
      onDoubleClick={onOpen}
    >
      {!item.virtual ? (
        <span className="task-drag-handle" {...attributes} {...listeners} title="Drag to reorder">
          ::
        </span>
      ) : (
        <span className="task-drag-handle" style={{ visibility: "hidden" }}>
          ::
        </span>
      )}
      <input
        type="checkbox"
        checked={item.checked}
        disabled={!!item.virtual}
        aria-label={`Mark ${item.title} ${item.checked ? "incomplete" : "complete"}`}
        onChange={onToggle}
      />
      <button type="button" className="todo-item__title" onClick={onOpen} onDoubleClick={onOpen}>
        <span className="todo-item__type muted">{item.entityType}</span>
        {item.title}
        {item.state ? <span className="muted"> · {item.state}</span> : null}
        {item.dueDate ? <span className="muted"> · {item.dueDate}</span> : null}
      </button>
      {!item.virtual ? (
        <button type="button" className="task-card-dismiss" aria-label="Remove from list" onClick={onRemove}>
          ×
        </button>
      ) : null}
    </div>
  );
}

type Props = {
  listId: number;
  /** When set, convert-to-task / create-task uses this project */
  defaultProjectId?: number | null;
};

export function TodoListView({ listId, defaultProjectId }: Props) {
  const qc = useQueryClient();
  const [openItem, setOpenItem] = useState<TodoListItem | null>(null);
  const [taskHeaderActions, setTaskHeaderActions] = useState<ReactNode>(null);
  const [pendingRemove, setPendingRemove] = useState<TodoListItem | null>(null);
  const [createType, setCreateType] = useState<"idea" | "task">("idea");
  const [createTitle, setCreateTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [linkType, setLinkType] = useState<"idea" | "task">("idea");
  const [pickId, setPickId] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

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
    enabled: linkType === "task",
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

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["todo-list", listId] });
    void qc.invalidateQueries({ queryKey: ["ideas"] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const createItem = useMutation({
    mutationFn: async () => {
      const projectId =
        createType === "task"
          ? (defaultProjectId ?? detailQuery.data?.projectId ?? null)
          : null;
      const body: { entityType: "idea" | "task"; title: string; projectId?: number } = {
        entityType: createType,
        title: createTitle.trim(),
      };
      if (createType === "task" && projectId != null) {
        body.projectId = projectId;
      }
      const res = await apiJson<{ data: TodoListItem }>(`/api/v1/todo-lists/${listId}/items/create`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: () => {
      setCreateTitle("");
      setCreateError(null);
      invalidate();
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const addExisting = useMutation({
    mutationFn: async () => {
      const entityId = Number(pickId);
      const res = await apiJson<{ data: TodoListItem }>(`/api/v1/todo-lists/${listId}/items`, {
        method: "POST",
        body: JSON.stringify({ entityType: linkType, entityId }),
      });
      return res.data;
    },
    onSuccess: () => {
      setPickId("");
      setLinkError(null);
      invalidate();
    },
    onError: (err: Error) => setLinkError(err.message),
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
    },
    onError: (err: Error) => setLinkError(err.message),
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
      const res = await apiJson<{ data: Task }>(`/api/v1/tasks/${openItem!.entityId}`);
      return res.data;
    },
  });

  const phasesQuery = useQuery({
    queryKey: ["phases", openTaskQuery.data?.projectId],
    enabled: openTaskQuery.data?.projectId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: ProjectPhase[] }>(
        `/api/v1/projects/${openTaskQuery.data!.projectId}/phases`,
      );
      return res.data;
    },
  });

  if (detailQuery.isLoading) return <p className="muted">Loading list…</p>;
  if (detailQuery.error) return <p role="alert">{(detailQuery.error as Error).message}</p>;
  if (!list) return <p className="muted">List not found.</p>;

  const pickOptions =
    linkType === "idea"
      ? (ideasQuery.data ?? []).map((i) => ({ id: i.id, label: i.title }))
      : (tasksQuery.data ?? []).map((t) => ({ id: t.id, label: t.title }));

  const convertProjectId = defaultProjectId ?? list.projectId ?? projectsQuery.data?.[0]?.id ?? null;

  return (
    <div className="todo-list-view">
      {list.kind !== "inbox" ? (
        <div className="field field--tags-below" style={{ marginBottom: "0.75rem" }}>
          <TagInput entityType="todo_list" entityId={list.id} />
        </div>
      ) : null}
      <div className="todo-create-row">
        <input
          type="text"
          placeholder="New item title"
          value={createTitle}
          onChange={(e) => setCreateTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && createTitle.trim()) createItem.mutate();
          }}
          aria-label="New item title"
        />
        <select
          className="todo-type-select"
          value={createType}
          onChange={(e) => setCreateType(e.target.value as "idea" | "task")}
          aria-label="New item type"
        >
          <option value="idea">Idea</option>
          <option value="task">Task</option>
        </select>
        <button
          type="button"
          className="btn primary"
          disabled={!createTitle.trim() || createItem.isPending}
          onClick={() => createItem.mutate()}
        >
          Add
        </button>
      </div>
      {createError ? (
        <p className="tag-input__error" role="alert">
          {createError}
        </p>
      ) : null}

      {list.kind !== "inbox" ? (
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
      ) : (
        <div>
          {items.map((item) => (
            <SortableItem
              key={item.id}
              item={item}
              onToggle={() => undefined}
              onOpen={() => setOpenItem(item)}
              onRemove={() => undefined}
            />
          ))}
        </div>
      )}
      {items.length === 0 ? <p className="muted">No items yet — create one above.</p> : null}

      {list.kind !== "inbox" ? (
      <div className="todo-link-existing">
        <h3>Add existing</h3>
        <div className="todo-add-row">
          <select
            className="todo-type-select"
            value={linkType}
            onChange={(e) => {
              setLinkType(e.target.value as "idea" | "task");
              setPickId("");
            }}
            aria-label="Existing item type"
          >
            <option value="idea">Idea</option>
            <option value="task">Task</option>
          </select>
          <select value={pickId} onChange={(e) => setPickId(e.target.value)} style={{ flex: 1 }} aria-label="Select existing record">
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
            disabled={!pickId || addExisting.isPending}
            onClick={() => addExisting.mutate()}
          >
            Add
          </button>
        </div>
        {linkError ? (
          <p className="tag-input__error" role="alert">
            {linkError}
          </p>
        ) : null}
      </div>
      ) : null}

      {openItem ? (
        <ElementShell
          mode="modal"
          entityType={openItem.entityType === "idea" ? "idea" : "task"}
          title={openItem.title}
          titleLeading={
            openItem.entityType === "task" && openTaskQuery.data
              ? formatTaskNumber(openTaskQuery.data.number)
              : undefined
          }
          showType={openItem.entityType !== "task"}
          accentColor={openItem.entityType === "task" ? openTaskQuery.data?.color : undefined}
          actions={openItem.entityType === "task" ? taskHeaderActions : undefined}
          open
          onClose={() => setOpenItem(null)}
          footer={
            <div className="btn-row">
              {openItem.href ? (
                <Link to={openItem.href} className="btn primary" onClick={() => setOpenItem(null)}>
                  Open full record
                </Link>
              ) : null}
              {openItem.entityType === "idea" && convertProjectId != null && !openItem.virtual ? (
                <button
                  type="button"
                  className="btn"
                  disabled={convert.isPending}
                  onClick={() => convert.mutate({ itemId: openItem.id, projectId: convertProjectId })}
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
            ) : openIdeaQuery.data ? (
              <div className="task-expand">
                <div className="field">
                  <label>Title</label>
                  <input
                    type="text"
                    defaultValue={openIdeaQuery.data.title}
                    onBlur={(e) => {
                      const title = e.target.value.trim();
                      if (title && title !== openIdeaQuery.data!.title) {
                        void apiJson(`/api/v1/ideas/${openIdeaQuery.data!.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ title }),
                        }).then(() => invalidate());
                      }
                    }}
                  />
                </div>
                <div className="field">
                  <label>Notes</label>
                  <MarkdownEditor
                    value={openIdeaQuery.data.body ?? ""}
                    onChange={() => {}}
                    height={180}
                    onBlur={(v) => {
                      void apiJson(`/api/v1/ideas/${openIdeaQuery.data!.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ body: v.trim() ? v : null }),
                      }).then(() => invalidate());
                    }}
                  />
                </div>
                <TagInput entityType="idea" entityId={openIdeaQuery.data.id} />
              </div>
            ) : (
              <p className="muted">Idea not found.</p>
            )
          ) : openTaskQuery.isLoading ? (
            <p className="muted">Loading…</p>
          ) : openTaskQuery.data ? (
            <TaskEditorFields
              key={openTaskQuery.data.id}
              task={openTaskQuery.data}
              phases={phasesQuery.data ?? []}
              onRequestClose={() => setOpenItem(null)}
              onHeaderActions={setTaskHeaderActions}
              onSavePatch={async (p) => {
                const task = openTaskQuery.data!;
                if (task.projectId != null) {
                  await apiJson(`/api/v1/projects/${task.projectId}/tasks/${task.id}`, {
                    method: "PATCH",
                    body: JSON.stringify(p),
                  });
                } else {
                  await apiJson(`/api/v1/tasks/${task.id}`, {
                    method: "PATCH",
                    body: JSON.stringify(p),
                  });
                }
                invalidate();
                void qc.invalidateQueries({ queryKey: ["task-solo", task.id] });
              }}
            />
          ) : (
            <p className="muted">Task not found.</p>
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
