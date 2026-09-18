import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { apiJson } from "../../api/client";
import { formatEntityRef } from "../../lib/entityRef";
import { patchTaskRecord } from "../../lib/patchTask";
import { formatTaskNumber } from "../../lib/taskFields";
import {
  OVERVIEW_PANEL_LIMITS,
  OVERVIEW_PANEL_META,
  OVERVIEW_PANEL_TYPES,
  OVERVIEW_PANELS_WITH_DAYS,
  isDefaultOriginPanel,
  newPanelInstance,
  rowsForPanel,
  type OverviewPanelInstance,
  type OverviewPanelLimit,
  type OverviewPanelType,
} from "../../lib/projectOverview";
import type { Task, Todo } from "../../types";
import { ConfirmDialog } from "../ConfirmDialog";
import { ElementShell } from "../shared/ElementShell";
import { TaskEditorFields } from "../TaskBoard";
import { TodoEditorFields } from "../TodoListView";

type PrefsResponse = {
  layout: OverviewPanelInstance[];
  customized: boolean;
  defaultLayout: OverviewPanelInstance[];
};

type Props = {
  projectId: number;
  tasks: Task[];
  todos: Todo[];
  userId: number | null;
  canManageSettings: boolean;
  loading?: boolean;
};

type RemoveTarget = {
  panel: OverviewPanelInstance;
  fromDefault: boolean;
};

export function OverviewPanels({
  projectId,
  tasks,
  todos,
  userId,
  canManageSettings,
  loading,
}: Props) {
  const qc = useQueryClient();
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [openTodo, setOpenTodo] = useState<Todo | null>(null);
  const [taskHeaderActions, setTaskHeaderActions] = useState<ReactNode>(null);
  const [editDefault, setEditDefault] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const prefsQuery = useQuery({
    queryKey: ["overview-prefs", projectId],
    queryFn: async () => {
      const res = await apiJson<{ data: PrefsResponse }>(
        `/api/v1/projects/${projectId}/overview-prefs`,
      );
      return res.data;
    },
  });

  const savePersonal = useMutation({
    mutationFn: async (layout: OverviewPanelInstance[]) => {
      const res = await apiJson<{ data: PrefsResponse }>(
        `/api/v1/projects/${projectId}/overview-prefs`,
        {
          method: "PUT",
          body: JSON.stringify({ layout }),
        },
      );
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["overview-prefs", projectId], data);
    },
  });

  const saveDefault = useMutation({
    mutationFn: async (layout: OverviewPanelInstance[]) => {
      const res = await apiJson<{ data: { layout: OverviewPanelInstance[] } }>(
        `/api/v1/projects/${projectId}/overview-default`,
        {
          method: "PUT",
          body: JSON.stringify({ layout }),
        },
      );
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["overview-prefs", projectId], (old: PrefsResponse | undefined) => {
        if (!old) {
          return {
            layout: data.layout,
            customized: false,
            defaultLayout: data.layout,
          };
        }
        return {
          ...old,
          defaultLayout: data.layout,
          layout: old.customized ? old.layout : data.layout,
        };
      });
    },
  });

  const resetPrefs = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: PrefsResponse }>(
        `/api/v1/projects/${projectId}/overview-prefs`,
        {
          method: "PUT",
          body: JSON.stringify({ reset: true }),
        },
      );
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["overview-prefs", projectId], data);
      setEditDefault(false);
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const data = prefsQuery.data;
  const personalLayout = data?.layout ?? [];
  const defaultLayout = data?.defaultLayout ?? [];
  const layout = editDefault ? defaultLayout : personalLayout;
  const customized = data?.customized === true;
  const saving =
    savePersonal.isPending || saveDefault.isPending || resetPrefs.isPending;

  const persistLayout = (next: OverviewPanelInstance[]) => {
    if (editDefault) {
      saveDefault.mutate(next);
    } else {
      savePersonal.mutate(next);
    }
  };

  const openRow = (type: OverviewPanelType, id: number) => {
    const meta = OVERVIEW_PANEL_META[type];
    if (meta.entity === "task") {
      const t = tasks.find((x) => x.id === id) ?? null;
      setOpenTodo(null);
      setOpenTask(t);
      return;
    }
    const t = todos.find((x) => x.id === id) ?? null;
    setOpenTask(null);
    setOpenTodo(t);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = layout.findIndex((p) => p.id === active.id);
    const newIndex = layout.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    persistLayout(arrayMove(layout, oldIndex, newIndex));
  };

  const requestRemove = (panel: OverviewPanelInstance) => {
    if (editDefault) {
      setRemoveTarget({ panel, fromDefault: true });
      return;
    }
    const fromDefault = isDefaultOriginPanel(panel.id, defaultLayout);
    setRemoveTarget({ panel, fromDefault });
  };

  const confirmRemove = () => {
    if (!removeTarget) return;
    persistLayout(layout.filter((p) => p.id !== removeTarget.panel.id));
    setRemoveTarget(null);
  };

  const addPanel = (type: OverviewPanelType) => {
    persistLayout([...layout, newPanelInstance(type)]);
    setAddOpen(false);
  };

  const updatePanel = (id: string, next: OverviewPanelInstance) => {
    persistLayout(layout.map((p) => (p.id === id ? next : p)));
  };

  return (
    <>
      <div className="overview-canvas-toolbar">
        <div className="overview-canvas-toolbar__actions">
          <button
            type="button"
            className="btn ghost"
            disabled={saving || prefsQuery.isLoading}
            onClick={() => setAddOpen((v) => !v)}
          >
            Add panel
          </button>
          {customized && !editDefault ? (
            <button
              type="button"
              className="btn ghost"
              disabled={saving}
              onClick={() => setResetOpen(true)}
            >
              Reset to default
            </button>
          ) : null}
          {canManageSettings ? (
            <button
              type="button"
              className={editDefault ? "btn primary" : "btn ghost"}
              disabled={saving}
              onClick={() => {
                setEditDefault((v) => !v);
                setAddOpen(false);
              }}
            >
              {editDefault ? "Done editing default" : "Edit project default"}
            </button>
          ) : null}
        </div>
        {editDefault ? (
          <p className="overview-canvas-banner" role="status">
            Editing the project default layout. Changes apply for viewers who have not
            customized their Overview.
          </p>
        ) : null}
        {addOpen ? (
          <div className="overview-catalog" role="listbox" aria-label="Panel catalog">
            {OVERVIEW_PANEL_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className="btn ghost overview-catalog__item"
                disabled={saving}
                onClick={() => addPanel(type)}
              >
                {OVERVIEW_PANEL_META[type].title}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={layout.map((p) => p.id)} strategy={rectSortingStrategy}>
          <div className="overview-panel-grid" aria-busy={loading || prefsQuery.isLoading}>
            {layout.map((panel) => {
              const pref = {
                limit: panel.limit,
                ...(OVERVIEW_PANELS_WITH_DAYS.has(panel.type)
                  ? { days: panel.days ?? 14 }
                  : {}),
              };
              const rows = rowsForPanel(panel.type, tasks, todos, pref, { userId });
              return (
                <SortableOverviewPanel
                  key={panel.id}
                  panel={panel}
                  rows={rows}
                  onOpen={(id) => openRow(panel.type, id)}
                  onPrefChange={(next) =>
                    updatePanel(panel.id, {
                      ...panel,
                      limit: next.limit,
                      ...(OVERVIEW_PANELS_WITH_DAYS.has(panel.type)
                        ? { days: next.days }
                        : { days: undefined }),
                    })
                  }
                  onRemove={() => requestRemove(panel)}
                  saving={saving}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {layout.length === 0 && !prefsQuery.isLoading ? (
        <p className="muted overview-canvas-empty">
          No panels on this Overview. Use Add panel to choose from the catalog.
        </p>
      ) : null}

      <ConfirmDialog
        open={removeTarget != null}
        title="Remove panel?"
        message={
          removeTarget?.fromDefault && !editDefault
            ? `Hide “${OVERVIEW_PANEL_META[removeTarget.panel.type].title}” from your Overview? It stays in the project default and will return if you Reset.`
            : editDefault
              ? `Remove “${removeTarget ? OVERVIEW_PANEL_META[removeTarget.panel.type].title : ""}” from the project default layout?`
              : `Remove “${removeTarget ? OVERVIEW_PANEL_META[removeTarget.panel.type].title : ""}”? This panel was added by you and will be deleted from your Overview. You can re-add it from the catalog later.`
        }
        warning={
          removeTarget && !removeTarget.fromDefault && !editDefault
            ? "You will need to recreate this panel if you want it back."
            : undefined
        }
        confirmLabel="Remove"
        confirmTone="danger"
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />

      <ConfirmDialog
        open={resetOpen}
        title="Reset Overview?"
        message="Restore your Overview to the project default layout? Your personal panel arrangement and prefs will be cleared."
        confirmLabel="Reset"
        confirmTone="primary"
        onConfirm={() => {
          setResetOpen(false);
          resetPrefs.mutate();
        }}
        onCancel={() => setResetOpen(false)}
      />

      {openTask ? (
        <ElementShell
          mode="modal"
          entityType="task"
          title={openTask.title}
          titleLeading={formatTaskNumber(openTask.number)}
          showType={false}
          accentColor={openTask.color}
          actions={taskHeaderActions}
          open
          onClose={() => {
            setOpenTask(null);
            setTaskHeaderActions(null);
          }}
        >
          <TaskEditorFields
            key={openTask.id}
            task={openTask}
            allTasks={tasks}
            onRequestClose={() => setOpenTask(null)}
            onDeleted={() => {
              setOpenTask(null);
              void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
            }}
            onHeaderActions={setTaskHeaderActions}
            onOpenTask={(id) => {
              const next = tasks.find((t) => t.id === id);
              if (next) setOpenTask(next);
            }}
            onSavePatch={async (p, opts) => {
              const updated = await patchTaskRecord(
                openTask.id,
                { ...p },
                openTask.projectId,
                opts,
              );
              setOpenTask(updated);
              void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
              return updated;
            }}
          />
        </ElementShell>
      ) : null}

      {openTodo ? (
        <ElementShell
          mode="modal"
          entityType="todo"
          title={openTodo.title}
          titleLeading={formatEntityRef("todo", openTodo.number)}
          showType={false}
          accentColor={openTodo.color ?? undefined}
          open
          onClose={() => setOpenTodo(null)}
        >
          <TodoEditorFields
            todo={openTodo}
            onSaved={() => {
              void qc.invalidateQueries({ queryKey: ["project-todos", projectId] });
              void qc.invalidateQueries({ queryKey: ["todos"] });
            }}
          />
        </ElementShell>
      ) : null}
    </>
  );
}

function SortableOverviewPanel({
  panel,
  rows,
  onOpen,
  onPrefChange,
  onRemove,
  saving,
}: {
  panel: OverviewPanelInstance;
  rows: Array<{
    id: number;
    number: number;
    title: string;
    meta: string | null;
    color: string | null;
  }>;
  onOpen: (id: number) => void;
  onPrefChange: (next: { limit: OverviewPanelLimit; days?: number }) => void;
  onRemove: () => void;
  saving: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: panel.id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : undefined,
    zIndex: isDragging ? 2 : undefined,
  };
  const meta = OVERVIEW_PANEL_META[panel.type];
  const prefDays = panel.days ?? 14;
  const [daysDraft, setDaysDraft] = useState(String(prefDays));
  const [daysSource, setDaysSource] = useState(prefDays);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (prefDays !== daysSource) {
    setDaysSource(prefDays);
    setDaysDraft(String(prefDays));
  }

  const commitDays = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      setDaysDraft(String(prefDays));
      return;
    }
    if (n === panel.days) return;
    onPrefChange({ limit: panel.limit, days: n });
  };

  const numberLabel = (n: number) =>
    meta.entity === "task" ? formatTaskNumber(n) : formatEntityRef("todo", n);

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={`overview-panel card${isDragging ? " is-dragging" : ""}`}
    >
      <header className="overview-panel__head">
        <button
          type="button"
          className="overview-panel__drag"
          aria-label={`Drag ${meta.title}`}
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
        <h3 className="overview-panel__title">{meta.title}</h3>
        <div className="overview-panel__prefs" aria-label={`${meta.title} preferences`}>
          <label className="overview-panel__pref">
            <span className="muted">Show</span>
            <select
              className="overview-panel__select"
              value={panel.limit}
              disabled={saving}
              onChange={(e) => {
                const limit = Number(e.target.value) as OverviewPanelLimit;
                onPrefChange(
                  meta.usesDays ? { limit, days: panel.days ?? 14 } : { limit },
                );
              }}
            >
              {OVERVIEW_PANEL_LIMITS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {meta.usesDays ? (
            <label className="overview-panel__pref">
              <span className="muted">Days</span>
              <input
                className="overview-panel__days"
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                value={daysDraft}
                disabled={saving}
                onChange={(e) => {
                  const value = e.target.value;
                  setDaysDraft(value);
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  debounceRef.current = setTimeout(() => commitDays(value), 400);
                }}
                onBlur={() => commitDays(daysDraft)}
              />
            </label>
          ) : null}
          <button
            type="button"
            className="overview-panel__remove"
            aria-label={`Remove ${meta.title}`}
            disabled={saving}
            onClick={onRemove}
          >
            ×
          </button>
        </div>
      </header>
      {rows.length === 0 ? (
        <p className="muted overview-panel__empty">Nothing to show</p>
      ) : (
        <ul className="overview-panel__list">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="overview-panel__row"
                onClick={() => onOpen(row.id)}
              >
                <span
                  className="overview-panel__stripe"
                  style={{ background: row.color ?? "transparent" }}
                  aria-hidden
                />
                <span className="muted overview-panel__num">{numberLabel(row.number)}</span>
                <span className="overview-panel__row-title">{row.title}</span>
                {row.meta ? <span className="muted overview-panel__meta">{row.meta}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
