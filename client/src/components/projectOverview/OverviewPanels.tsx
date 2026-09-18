import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiJson } from "../../api/client";
import { formatEntityRef } from "../../lib/entityRef";
import { patchTaskRecord } from "../../lib/patchTask";
import { formatTaskNumber } from "../../lib/taskFields";
import {
  OVERVIEW_PANEL_LAYOUT,
  OVERVIEW_PANEL_LIMITS,
  OVERVIEW_PANEL_META,
  OVERVIEW_PANELS_WITH_DAYS,
  rowsForPanel,
  type OverviewPanelKey,
  type OverviewPanelLimit,
  type OverviewPanelPref,
  type OverviewPanelsPrefs,
} from "../../lib/projectOverview";
import type { Task, Todo } from "../../types";
import { ElementShell } from "../shared/ElementShell";
import { TaskEditorFields } from "../TaskBoard";
import { TodoEditorFields } from "../TodoListView";

type PrefsResponse = {
  panels: OverviewPanelsPrefs;
  isDefault: boolean;
};

type Props = {
  projectId: number;
  tasks: Task[];
  todos: Todo[];
  loading?: boolean;
};

export function OverviewPanels({ projectId, tasks, todos, loading }: Props) {
  const qc = useQueryClient();
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [openTodo, setOpenTodo] = useState<Todo | null>(null);
  const [taskHeaderActions, setTaskHeaderActions] = useState<ReactNode>(null);

  const prefsQuery = useQuery({
    queryKey: ["overview-prefs", projectId],
    queryFn: async () => {
      const res = await apiJson<{ data: PrefsResponse }>(
        `/api/v1/projects/${projectId}/overview-prefs`,
      );
      return res.data;
    },
  });

  const savePrefs = useMutation({
    mutationFn: async (panels: Partial<Record<OverviewPanelKey, OverviewPanelPref>>) => {
      const res = await apiJson<{ data: PrefsResponse }>(
        `/api/v1/projects/${projectId}/overview-prefs`,
        {
          method: "PUT",
          body: JSON.stringify({ panels, mode: "merge" }),
        },
      );
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["overview-prefs", projectId], data);
    },
  });

  const panels = prefsQuery.data?.panels;

  const openRow = (key: OverviewPanelKey, id: number) => {
    const meta = OVERVIEW_PANEL_META[key];
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

  return (
    <>
      <div className="overview-panel-grid" aria-busy={loading || prefsQuery.isLoading}>
        {OVERVIEW_PANEL_LAYOUT.map((key) => {
          const pref = panels?.[key] ?? {
            limit: 5 as OverviewPanelLimit,
            ...(OVERVIEW_PANELS_WITH_DAYS.has(key) ? { days: 14 } : {}),
          };
          const rows = panels ? rowsForPanel(key, tasks, todos, pref) : [];
          return (
            <OverviewListPanel
              key={key}
              panelKey={key}
              pref={pref}
              rows={rows}
              onOpen={(id) => openRow(key, id)}
              onPrefChange={(next) => savePrefs.mutate({ [key]: next })}
              saving={savePrefs.isPending}
            />
          );
        })}
      </div>

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

function OverviewListPanel({
  panelKey,
  pref,
  rows,
  onOpen,
  onPrefChange,
  saving,
}: {
  panelKey: OverviewPanelKey;
  pref: OverviewPanelPref;
  rows: Array<{
    id: number;
    number: number;
    title: string;
    meta: string | null;
    color: string | null;
  }>;
  onOpen: (id: number) => void;
  onPrefChange: (next: OverviewPanelPref) => void;
  saving: boolean;
}) {
  const meta = OVERVIEW_PANEL_META[panelKey];
  const [daysDraft, setDaysDraft] = useState(String(pref.days ?? 14));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDaysDraft(String(pref.days ?? 14));
  }, [pref.days]);

  const commitDays = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      setDaysDraft(String(pref.days ?? 14));
      return;
    }
    if (n === pref.days) return;
    onPrefChange({ limit: pref.limit, days: n });
  };

  const numberLabel = (n: number) =>
    meta.entity === "task" ? formatTaskNumber(n) : formatEntityRef("todo", n);

  return (
    <section className="overview-panel card">
      <header className="overview-panel__head">
        <h3 className="overview-panel__title">{meta.title}</h3>
        <div className="overview-panel__prefs" aria-label={`${meta.title} preferences`}>
          <label className="overview-panel__pref">
            <span className="muted">Show</span>
            <select
              className="overview-panel__select"
              value={pref.limit}
              disabled={saving}
              onChange={(e) => {
                const limit = Number(e.target.value) as OverviewPanelLimit;
                onPrefChange(
                  meta.usesDays ? { limit, days: pref.days ?? 14 } : { limit },
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
