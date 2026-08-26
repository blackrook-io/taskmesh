import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { apiJson } from "../api/client";
import { formatEntityRef } from "../lib/entityRef";
import { sanitizePlainText } from "../lib/plainText";
import {
  INLINE_TODO_LIST_STATES,
  evaluateTodoListFilter,
  isTodoFilterActive,
  reorderVisibleAmongAll,
  storageKeyForTodoList,
} from "../lib/todoListFilter";
import { usePersistedTodoListFilter } from "../lib/usePersistedTodoListFilter";
import { useTodoListFilterLookups } from "../lib/useTodoListFilterLookups";
import {
  SELECTABLE_TASK_STATES,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATE_LABELS,
  formatTaskNumber,
  isSelectableTaskState,
  taskPriorityClass,
  taskStateClass,
  type SelectableTaskState,
  type TaskPriority,
  type TaskState,
} from "../lib/taskFields";
import { patchTaskRecord } from "../lib/patchTask";
import type { Project, Task, Todo, TodoListDetail, TodoListItem } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { TodoListFilterBar } from "./TodoListFilterBar";
import { TaskEditorFields } from "./TaskBoard";
import { ColorPopover } from "./shared/ColorPopover";
import { ElementShell } from "./shared/ElementShell";
import { MarkdownEditor } from "./shared/MarkdownEditor";
import { RowTagChips } from "./shared/RowTagChips";
import { TagInput } from "./shared/TagInput";

function inlineStateOptions(current: string | undefined): readonly string[] {
  if (current === "pending") return ["pending", ...INLINE_TODO_LIST_STATES];
  return INLINE_TODO_LIST_STATES;
}

function SortableItem({
  item,
  dragDisabled,
  onToggle,
  onOpen,
  onRemove,
  onPatchEntity,
}: {
  item: TodoListItem;
  dragDisabled?: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onRemove: () => void;
  onPatchEntity: (patch: Record<string, unknown>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: dragDisabled || !!item.virtual,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const typeLabel =
    item.entityType === "todo" ? "ToDo" : item.entityType === "task" ? "Task" : "Idea";
  const canInline = item.entityType === "todo" || item.entityType === "task";
  const stateValue = (item.state && isSelectableTaskState(item.state) ? item.state : "new") as TaskState;
  const priorityValue = (TASK_PRIORITIES.includes((item.priority ?? "none") as TaskPriority)
    ? item.priority
    : "none") as TaskPriority;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`todo-item${canInline ? "" : " todo-item--compact"}${isDragging ? " dragging" : ""}${item.checked ? " is-checked" : ""}`}
      onDoubleClick={onOpen}
    >
      {!item.virtual && !dragDisabled ? (
        <span className="task-drag-handle" {...attributes} {...listeners} title="Drag to reorder">
          ::
        </span>
      ) : (
        <span className="task-drag-handle" style={{ visibility: "hidden" }} aria-hidden>
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
      <span className="todo-item__type muted">{typeLabel}</span>
      <button type="button" className="todo-item__title" onClick={onOpen} onDoubleClick={onOpen}>
        <span className="todo-item__title-text">{item.title}</span>
        {canInline ? (
          <RowTagChips entityType={item.entityType} entityId={item.entityId} />
        ) : item.entityType === "idea" ? (
          <RowTagChips entityType="idea" entityId={item.entityId} />
        ) : null}
      </button>
      {canInline ? (
        <>
          <select
            className={taskStateClass("task-list-row__state", stateValue)}
            value={stateValue}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onPatchEntity({ state: e.target.value })}
            aria-label="State"
          >
            {inlineStateOptions(item.state).map((s) => (
              <option key={s} value={s}>
                {TASK_STATE_LABELS[s as TaskState]}
              </option>
            ))}
          </select>
          <select
            className={taskPriorityClass("task-list-row__priority", priorityValue)}
            value={priorityValue}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onPatchEntity({ priority: e.target.value })}
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
            value={item.dueDate ?? ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onPatchEntity({ dueDate: e.target.value || null })}
            aria-label="Due date"
          />
        </>
      ) : null}
      {!item.virtual ? (
        <button type="button" className="task-card-dismiss" aria-label="Remove from list" onClick={onRemove}>
          ×
        </button>
      ) : (
        <span aria-hidden />
      )}
    </div>
  );
}

function datetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TodoEditorFields({
  todo,
  onSaved,
}: {
  todo: Todo;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description ?? "");
  const [state, setState] = useState(todo.state);
  const [priority, setPriority] = useState(todo.priority);
  const [dueLocal, setDueLocal] = useState(todo.dueDate ?? "");
  const [actionByLocal, setActionByLocal] = useState(datetimeLocalValue(todo.actionBy));
  const [color, setColor] = useState(todo.color);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(todo.title);
    setDescription(todo.description ?? "");
    setState(todo.state);
    setPriority(todo.priority);
    setDueLocal(todo.dueDate ?? "");
    setActionByLocal(datetimeLocalValue(todo.actionBy));
    setColor(todo.color);
  }, [todo]);

  const patch = async (body: Record<string, unknown>) => {
    try {
      setSaveError(null);
      await apiJson(`/api/v1/todos/${todo.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  return (
    <div className="task-expand">
      <div className="field">
        <div className="task-expand__title-head">
          <label htmlFor={`d-title-${todo.id}`}>Title</label>
        </div>
        <input
          id={`d-title-${todo.id}`}
          type="text"
          value={title}
          onChange={(e) => setTitle(sanitizePlainText(e.target.value))}
          onBlur={() => {
            const next = title.trim();
            if (next && next !== todo.title) void patch({ title: next });
          }}
        />
      </div>
      <div className="task-editor-grid">
        <div className="field">
          <label htmlFor={`d-state-${todo.id}`}>State</label>
          <select
            id={`d-state-${todo.id}`}
            value={state}
            onChange={(e) => {
              const next = e.target.value as SelectableTaskState;
              setState(next);
              void patch({ state: next });
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
          <label htmlFor={`d-pri-${todo.id}`}>Priority</label>
          <select
            id={`d-pri-${todo.id}`}
            value={priority}
            onChange={(e) => {
              const next = e.target.value as TaskPriority;
              setPriority(next);
              void patch({ priority: next });
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
          <label htmlFor={`d-due-${todo.id}`}>Due date</label>
          <div className="task-editor-date-color__row">
            <input
              id={`d-due-${todo.id}`}
              type="date"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
              onBlur={() => {
                const next = dueLocal || null;
                if (next !== (todo.dueDate ?? null)) void patch({ dueDate: next });
              }}
            />
            <div className="task-color-swatch" title={color ?? "default"}>
              <ColorPopover
                color={color}
                label="ToDo color"
                placement="left"
                onChange={(c) => {
                  setColor(c);
                  void patch({ color: c });
                }}
              />
              <span className="task-color-swatch__hex muted">{color ?? "default"}</span>
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`d-action-${todo.id}`}>Action by</label>
          <input
            id={`d-action-${todo.id}`}
            type="datetime-local"
            value={actionByLocal}
            onChange={(e) => setActionByLocal(e.target.value)}
            onBlur={() => {
              const next = actionByLocal.trim()
                ? new Date(actionByLocal).toISOString()
                : null;
              const prev = todo.actionBy ?? null;
              if (next !== prev) void patch({ actionBy: next });
            }}
          />
        </div>
      </div>
      <div className="field task-expand__notes">
        <div className="task-expand__notes-head">
          <label>Description</label>
        </div>
        <MarkdownEditor
          key={`${todo.id}-description`}
          value={description}
          onChange={setDescription}
          height={280}
          placeholder="ToDo description…"
          onBlur={(v) => {
            setDescription(v);
            const normalized = v.trim() ? v : null;
            if (normalized !== (todo.description ?? null)) {
              void patch({ description: normalized });
            }
          }}
        />
      </div>
      <div className="field field--tags-below">
        <TagInput entityType="todo" entityId={todo.id} />
      </div>
      {saveError ? (
        <p role="alert" className="tag-input__error">
          {saveError}
        </p>
      ) : null}
    </div>
  );
}

type Props = {
  listId: number;
  /** When set, convert-to-task / create uses this project */
  defaultProjectId?: number | null;
};

export function TodoListView({ listId, defaultProjectId }: Props) {
  const qc = useQueryClient();
  const [openItem, setOpenItem] = useState<TodoListItem | null>(null);
  const [taskHeaderActions, setTaskHeaderActions] = useState<ReactNode>(null);
  const [pendingRemove, setPendingRemove] = useState<TodoListItem | null>(null);
  const [createType, setCreateType] = useState<"todo" | "task">("todo");
  const [createTitle, setCreateTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [linkType, setLinkType] = useState<"todo" | "task">("todo");
  const [pickId, setPickId] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const filterStorageKey = storageKeyForTodoList(listId);
  const {
    filter: listFilter,
    applyFilter,
    clearFilter,
  } = usePersistedTodoListFilter(filterStorageKey);
  const { filterCtx } = useTodoListFilterLookups();

  const detailQuery = useQuery({
    queryKey: ["todo-list", listId],
    queryFn: async () => {
      const res = await apiJson<{ data: TodoListDetail }>(`/api/v1/todo-lists/${listId}`);
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

  const todosQuery = useQuery({
    queryKey: ["todos-for-link", defaultProjectId],
    enabled: linkType === "todo",
    queryFn: async () => {
      const res = await apiJson<{ data: Todo[] }>("/api/v1/todos");
      const all = res.data;
      if (defaultProjectId) {
        return all.filter((t) => t.projectId === defaultProjectId || t.projectId == null);
      }
      return all;
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
      const unassigned = await apiJson<{ data: Task[] }>("/api/v1/tasks?projectId=null");
      all.push(...unassigned.data);
      return all;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["todo-list", listId] });
    void qc.invalidateQueries({ queryKey: ["todos"] });
    void qc.invalidateQueries({ queryKey: ["todos-for-link"] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void qc.invalidateQueries({ queryKey: ["ideas"] });
    void qc.invalidateQueries({ queryKey: ["taggings"] });
  };

  const createItem = useMutation({
    mutationFn: async () => {
      const projectId = defaultProjectId ?? detailQuery.data?.projectId ?? null;
      const body: { entityType: "todo" | "task"; title: string; projectId?: number } = {
        entityType: createType,
        title: createTitle.trim(),
      };
      if (projectId != null) {
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

  const patchEntity = useMutation({
    mutationFn: async ({
      item,
      patch,
    }: {
      item: TodoListItem;
      patch: Record<string, unknown>;
    }) => {
      if (item.entityType === "todo") {
        await apiJson(`/api/v1/todos/${item.entityId}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        return;
      }
      if (item.entityType === "task") {
        await patchTaskRecord(item.entityId, patch, null);
        return;
      }
      throw new Error("Inline edit is only supported for ToDos and Tasks");
    },
    onSuccess: () => {
      setInlineError(null);
      invalidate();
    },
    onError: (err: Error) => setInlineError(err.message),
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

  const convertToTask = useMutation({
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

  const convertToTodo = useMutation({
    mutationFn: async ({ itemId }: { itemId: number }) => {
      const res = await apiJson<{ data: { item: TodoListItem; todo: Todo } }>(
        `/api/v1/todo-lists/${listId}/items/${itemId}/convert-to-todo`,
        {
          method: "POST",
          body: JSON.stringify({
            projectId: defaultProjectId ?? detailQuery.data?.projectId ?? null,
          }),
        },
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
  const visibleItems = useMemo(
    () => evaluateTodoListFilter(items, listFilter, filterCtx),
    [items, listFilter, filterCtx],
  );
  const visibleIds = useMemo(() => visibleItems.map((i) => i.id), [visibleItems]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const filterActive = isTodoFilterActive(listFilter);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const next = reorderVisibleAmongAll(items, visibleItems, Number(active.id), Number(over.id));
    if (!next) return;
    await reorder.mutateAsync(next.map((i) => i.id));
  };

  const openIdeaQuery = useQuery({
    queryKey: ["idea", openItem?.entityId],
    enabled: openItem?.entityType === "idea",
    queryFn: async () => {
      const res = await apiJson<{ data: { id: number; title: string; body: string | null } }>(
        `/api/v1/ideas/${openItem!.entityId}`,
      );
      return res.data;
    },
  });

  const openTodoQuery = useQuery({
    queryKey: ["todo-solo", openItem?.entityId],
    enabled: openItem?.entityType === "todo",
    queryFn: async () => {
      const res = await apiJson<{ data: Todo }>(`/api/v1/todos/${openItem!.entityId}`);
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

  if (detailQuery.isLoading) return <p className="muted">Loading list…</p>;
  if (detailQuery.error) return <p role="alert">{(detailQuery.error as Error).message}</p>;
  if (!list) return <p className="muted">List not found.</p>;

  const pickOptions =
    linkType === "todo"
      ? (todosQuery.data ?? []).map((t) => ({
          id: t.id,
          label: `${formatEntityRef("todo", t.number)} ${t.title}`,
        }))
      : (tasksQuery.data ?? []).map((t) => ({
          id: t.id,
          label: `${formatTaskNumber(t.number)} ${t.title}`,
        }));

  const convertProjectId = defaultProjectId ?? list.projectId ?? projectsQuery.data?.[0]?.id ?? null;

  const shellEntityType =
    openItem?.entityType === "todo"
      ? "todo"
      : openItem?.entityType === "idea"
        ? "idea"
        : "task";

  const renderItem = (item: TodoListItem, opts?: { readOnlyMembership?: boolean }) => (
    <SortableItem
      key={item.id}
      item={item}
      dragDisabled={list.kind === "inbox" || !!opts?.readOnlyMembership}
      onToggle={() => {
        if (opts?.readOnlyMembership) return;
        patchItem.mutate({ itemId: item.id, checked: !item.checked });
      }}
      onOpen={() => setOpenItem(item)}
      onRemove={() => {
        if (opts?.readOnlyMembership) return;
        setPendingRemove(item);
      }}
      onPatchEntity={(patch) => patchEntity.mutate({ item, patch })}
    />
  );

  return (
    <div className="todo-list-view">
      <div className="todo-create-row">
        <input
          type="text"
          placeholder="New item title"
          value={createTitle}
          onChange={(e) => setCreateTitle(sanitizePlainText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && createTitle.trim()) createItem.mutate();
          }}
          aria-label="New item title"
        />
        <select
          className="todo-type-select"
          value={createType}
          onChange={(e) => setCreateType(e.target.value as "todo" | "task")}
          aria-label="New item type"
        >
          <option value="todo">ToDo</option>
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

      <TodoListFilterBar filter={listFilter} onApply={applyFilter} onClear={clearFilter} />
      {inlineError ? (
        <p className="tag-input__error" role="alert">
          {inlineError}
        </p>
      ) : null}

      {list.kind !== "inbox" ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e)}>
          <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
            {visibleItems.map((item) => renderItem(item))}
          </SortableContext>
        </DndContext>
      ) : (
        <div>{visibleItems.map((item) => renderItem(item, { readOnlyMembership: true }))}</div>
      )}
      {items.length === 0 ? (
        <p className="muted">No items yet — create one above.</p>
      ) : visibleItems.length === 0 && filterActive ? (
        <p className="muted">No items match this filter.</p>
      ) : null}

      {list.kind !== "inbox" ? (
        <div className="todo-link-existing">
          <h3>Add existing</h3>
          <div className="todo-add-row">
            <select
              className="todo-type-select"
              value={linkType}
              onChange={(e) => {
                setLinkType(e.target.value as "todo" | "task");
                setPickId("");
              }}
              aria-label="Existing item type"
            >
              <option value="todo">ToDo</option>
              <option value="task">Task</option>
            </select>
            <select
              value={pickId}
              onChange={(e) => setPickId(e.target.value)}
              style={{ flex: 1 }}
              aria-label="Select existing record"
            >
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
          entityType={shellEntityType}
          title={
            openItem.entityType === "todo" && openTodoQuery.data
              ? openTodoQuery.data.title
              : openItem.entityType === "task" && openTaskQuery.data
                ? openTaskQuery.data.title
                : openItem.title
          }
          titleLeading={
            openItem.entityType === "todo" && openTodoQuery.data
              ? formatEntityRef("todo", openTodoQuery.data.number)
              : openItem.entityType === "task" && openTaskQuery.data
                ? formatTaskNumber(openTaskQuery.data.number)
                : undefined
          }
          showType={openItem.entityType === "idea"}
          accentColor={
            openItem.entityType === "todo"
              ? openTodoQuery.data?.color ?? undefined
              : openItem.entityType === "task"
                ? openTaskQuery.data?.color
                : undefined
          }
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
              {openItem.entityType === "idea" && !openItem.virtual ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={convertToTodo.isPending}
                    onClick={() => convertToTodo.mutate({ itemId: openItem.id })}
                  >
                    Convert to ToDo
                  </button>
                  {convertProjectId != null ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={convertToTask.isPending}
                      onClick={() =>
                        convertToTask.mutate({ itemId: openItem.id, projectId: convertProjectId })
                      }
                    >
                      Convert to task
                    </button>
                  ) : null}
                </>
              ) : null}
              {openItem.entityType === "todo" && convertProjectId != null && !openItem.virtual ? (
                <button
                  type="button"
                  className="btn"
                  disabled={convertToTask.isPending}
                  onClick={() =>
                    convertToTask.mutate({ itemId: openItem.id, projectId: convertProjectId })
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
            ) : openIdeaQuery.data ? (
              <div className="task-expand">
                <p className="muted">
                  Legacy list membership — Ideas now live under{" "}
                  <Link to="/ideas" onClick={() => setOpenItem(null)}>
                    Ideas
                  </Link>
                  . Convert to a ToDo or Task, or remove from this list.
                </p>
                <div className="field">
                  <label>Title</label>
                  <input
                    type="text"
                    defaultValue={openIdeaQuery.data.title}
                    onBlur={(e) => {
                      const title = sanitizePlainText(e.target.value).trim();
                      if (title && title !== openIdeaQuery.data!.title) {
                        void apiJson(`/api/v1/ideas/${openIdeaQuery.data!.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ title }),
                        }).then(() => {
                          invalidate();
                          void qc.invalidateQueries({ queryKey: ["idea", openIdeaQuery.data!.id] });
                        });
                      }
                    }}
                  />
                </div>
                <div className="field">
                  <label>Description</label>
                  <MarkdownEditor
                    value={openIdeaQuery.data.body ?? ""}
                    onChange={() => {}}
                    height={180}
                    placeholder="Idea description…"
                    onBlur={(v) => {
                      void apiJson(`/api/v1/ideas/${openIdeaQuery.data!.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ body: v.trim() ? v : null }),
                      }).then(() => {
                        invalidate();
                        void qc.invalidateQueries({ queryKey: ["idea", openIdeaQuery.data!.id] });
                      });
                    }}
                  />
                </div>
                <div className="field field--tags-below">
                  <TagInput entityType="idea" entityId={openIdeaQuery.data.id} />
                </div>
              </div>
            ) : (
              <p className="muted">Idea not found.</p>
            )
          ) : openItem.entityType === "todo" ? (
            openTodoQuery.isLoading ? (
              <p className="muted">Loading…</p>
            ) : openTodoQuery.data ? (
              <TodoEditorFields
                key={openTodoQuery.data.id}
                todo={openTodoQuery.data}
                onSaved={() => {
                  invalidate();
                  void qc.invalidateQueries({ queryKey: ["todo-solo", openTodoQuery.data!.id] });
                }}
              />
            ) : (
              <p className="muted">ToDo not found.</p>
            )
          ) : openTaskQuery.isLoading ? (
            <p className="muted">Loading…</p>
          ) : openTaskQuery.data ? (
            <TaskEditorFields
              key={openTaskQuery.data.id}
              task={openTaskQuery.data}
              onRequestClose={() => setOpenItem(null)}
              onDeleted={() => {
                setOpenItem(null);
                invalidate();
              }}
              onHeaderActions={setTaskHeaderActions}
              onOpenTask={(id) => {
                setOpenItem({
                  id: -1,
                  listId: openItem?.listId ?? 0,
                  entityType: "task",
                  entityId: id,
                  sortOrder: 0,
                  checked: false,
                  createdAt: "",
                  updatedAt: "",
                  title: "",
                  href: null,
                  virtual: true,
                });
              }}
              onSavePatch={async (p, opts) => {
                const task = openTaskQuery.data!;
                const updated = await patchTaskRecord(task.id, { ...p }, task.projectId, opts);
                invalidate();
                void qc.invalidateQueries({ queryKey: ["task-solo", task.id] });
                return updated;
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
        message="The ToDo or task itself is not deleted — only this list entry."
        confirmLabel="Remove"
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          if (pendingRemove) removeItem.mutate(pendingRemove.id);
        }}
      />
    </div>
  );
}
