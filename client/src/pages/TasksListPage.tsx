import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { apiJson } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CHILD_TITLE_INDENT_PX, StateCheckbox, TaskEditorFields } from "../components/TaskBoard";
import {
  TaskListContextMenu,
  ctxFieldFromEventTarget,
  type TaskListContextMenuItem,
  type TaskListContextMenuState,
} from "../components/TaskListContextMenu";
import { MoveTaskToProjectModal } from "../components/MoveTaskToProjectModal";
import { SetTaskParentModal } from "../components/SetTaskParentModal";
import { AssignToUserModal } from "../components/AssignToUserModal";
import { TaskListFilterBar } from "../components/TaskListFilterBar";
import { ElementShell } from "../components/shared/ElementShell";
import {
  TaskListColumnHeaders,
  renderTaskColumnCell,
} from "../components/shared/TaskListColumnCells";
import { ListViewHeaderMenu, type ListViewHeaderMenuState } from "../components/shared/ListViewHeaderMenu";
import { ListViewPersonalizeModal } from "../components/shared/ListViewPersonalizeModal";
import {
  fetchOpenDependsOn,
  formatCompleteBlockMessage,
} from "../components/shared/TaskDependencyLists";
import { buildTaskListGridTemplate } from "../lib/listViewColumns";
import { useListViewColumns } from "../lib/useListViewColumns";
import {
  formatTaskNumber,
  nextTaskState,
  TASK_STATE_SORT_RANK,
} from "../lib/taskFields";
import {
  evaluateTaskListFilter,
  isFilterActive,
  storageKeyForGlobalTasks,
} from "../lib/taskListFilter";
import { usePhaseFilterOptions } from "../lib/usePhaseFilterOptions";
import { useTaskFilterLookups } from "../lib/useTaskFilterLookups";
import {
  DEFAULT_GLOBAL_TASK_LIST_SORT,
  TASK_LIST_SORT_COLS,
  storageKeyForGlobalTaskSort,
  type TaskListSortCol,
} from "../lib/taskListSort";
import { usePersistedTaskListFilter } from "../lib/usePersistedTaskListFilter";
import { usePersistedTaskListSort } from "../lib/usePersistedTaskListSort";
import type { Project, Task } from "../types";

type SortCol = TaskListSortCol;

type DisplayRow = {
  task: Task;
  depth: number;
  hasChildren: boolean;
};

function taskDue(task: Task): string | null {
  return task.dueDate ?? (task.dueAt ? task.dueAt.slice(0, 10) : null);
}

function childrenOf(tasks: Task[], parentId: number): Task[] {
  return tasks
    .filter((t) => t.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

function sortTasks(list: Task[], col: SortCol | null, dir: 1 | -1, projectName: (id: number | null) => string) {
  if (!col) return list;
  const stateRank: Record<Task["state"], number> = TASK_STATE_SORT_RANK;
  const priRank: Record<Task["priority"], number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
    urgent: 4,
  };
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (col === "number") cmp = a.number - b.number;
    else if (col === "title") cmp = a.title.localeCompare(b.title);
    else if (col === "state") cmp = stateRank[a.state] - stateRank[b.state];
    else if (col === "priority") cmp = priRank[a.priority] - priRank[b.priority];
    else if (col === "dueDate") {
      const da = taskDue(a) ?? "";
      const db = taskDue(b) ?? "";
      cmp = da.localeCompare(db);
    } else if (col === "project") {
      cmp = projectName(a.projectId).localeCompare(projectName(b.projectId));
    } else if (col === "createdAt") {
      cmp = a.createdAt.localeCompare(b.createdAt);
    } else if (col === "updatedAt") {
      cmp = a.updatedAt.localeCompare(b.updatedAt);
    } else if (col === "phase") {
      cmp = (a.phaseId ?? 0) - (b.phaseId ?? 0);
    }
    return (cmp || a.id - b.id) * dir;
  });
}

function buildGlobalDisplayRows(
  filtered: Task[],
  collapsedParents: Set<number>,
  sortCol: SortCol | null,
  sortDir: 1 | -1,
  projectName: (id: number | null) => string,
): DisplayRow[] {
  const matchedIds = new Set(filtered.map((t) => t.id));
  const visualRoots = filtered.filter((t) => t.parentId == null || !matchedIds.has(t.parentId));
  const sortedRoots = sortTasks(visualRoots, sortCol, sortDir, projectName);
  const rows: DisplayRow[] = [];
  const walk = (t: Task, depth: number) => {
    const visibleKids = childrenOf(filtered, t.id).filter((c) => matchedIds.has(c.id));
    rows.push({ task: t, depth, hasChildren: visibleKids.length > 0 });
    if (collapsedParents.has(t.id)) return;
    for (const c of visibleKids) walk(c, depth + 1);
  };
  for (const root of sortedRoots) walk(root, 0);
  return rows;
}

export function TasksListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const filter = searchParams.get("filter") === "unassigned" ? "unassigned" : "all";
  const openParam = searchParams.get("open");
  const wantNew = searchParams.get("new") === "1";
  const parsedOpenId =
    openParam != null && Number.isFinite(Number(openParam)) ? Number(openParam) : null;

  const [modalTaskId, setModalTaskId] = useState<number | null>(parsedOpenId);
  const [modalTaskHeld, setModalTaskHeld] = useState<Task | null>(null);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [completeBlockMsg, setCompleteBlockMsg] = useState<string | null>(null);
  const [collapsedParents, setCollapsedParents] = useState<Set<number>>(() => new Set());
  const sortStorageKey = storageKeyForGlobalTaskSort(filter);
  const { sortCol, sortDir, setSort } = usePersistedTaskListSort(
    sortStorageKey,
    DEFAULT_GLOBAL_TASK_LIST_SORT,
  );
  const [ctxMenu, setCtxMenu] = useState<TaskListContextMenuState | null>(null);
  const [headerMenu, setHeaderMenu] = useState<ListViewHeaderMenuState>(null);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  const [personalizeError, setPersonalizeError] = useState<string | null>(null);
  const [moveTaskId, setMoveTaskId] = useState<number | null>(null);
  const [parentTaskId, setParentTaskId] = useState<number | null>(null);
  const [assignTaskId, setAssignTaskId] = useState<number | null>(null);
  const [prevWantNew, setPrevWantNew] = useState(wantNew);
  const [urlCreateNonce, setUrlCreateNonce] = useState(() => (wantNew ? 1 : 0));
  const {
    visibleColumns,
    personalizeRows,
    save: saveListCols,
    reset: resetListCols,
  } = useListViewColumns("tasks", "global");
  const gridTemplate = useMemo(
    () => buildTaskListGridTemplate(visibleColumns, "global"),
    [visibleColumns],
  );

  // Adopt ?open= during render (do not clear modal when the param is stripped).
  if (parsedOpenId != null && parsedOpenId !== modalTaskId) {
    setModalTaskId(parsedOpenId);
  }

  if (wantNew !== prevWantNew) {
    setPrevWantNew(wantNew);
    if (wantNew) setUrlCreateNonce((n) => n + 1);
  }

  const tasksQuery = useQuery({
    queryKey: ["tasks", "all", filter],
    queryFn: async () => {
      const q = filter === "unassigned" ? "?projectId=null" : "";
      const res = await apiJson<{ data: Task[] }>(`/api/v1/tasks${q}`);
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

  const projectNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of projectsQuery.data ?? []) map.set(p.id, p.name);
    return map;
  }, [projectsQuery.data]);

  const projectLabel = (id: number | null) =>
    id == null ? "—" : (projectNameById.get(id) ?? `Project #${id}`);

  const taskListFilterKey = storageKeyForGlobalTasks(filter);
  const {
    filter: taskListFilter,
    applyFilter: applyTaskListFilter,
    clearFilter: clearTaskListFilter,
  } = usePersistedTaskListFilter(taskListFilterKey);

  const { phaseNames } = usePhaseFilterOptions();
  const { filterCtx: tagProjectCtx } = useTaskFilterLookups({ includeProjects: true });
  const filterCtx = useMemo(
    () => ({ ...tagProjectCtx, phaseNames }),
    [tagProjectCtx, phaseNames],
  );
  const phaseNameFn = (id: number | null) => (id != null ? (phaseNames.get(id) ?? "") : "");

  const filteredTasks = useMemo(() => {
    return evaluateTaskListFilter(tasksQuery.data ?? [], taskListFilter, filterCtx);
  }, [tasksQuery.data, taskListFilter, filterCtx]);

  const effectiveSortCol = useMemo(() => {
    const visibleSortKeys = new Set(visibleColumns.filter((c) => c.sortable).map((c) => c.fieldKey));
    return sortCol != null && visibleSortKeys.has(sortCol) ? sortCol : null;
  }, [visibleColumns, sortCol]);

  const displayRows = useMemo(
    () =>
      buildGlobalDisplayRows(
        filteredTasks,
        collapsedParents,
        effectiveSortCol,
        sortDir,
        (id) => (id == null ? "—" : (projectNameById.get(id) ?? `Project #${id}`)),
      ),
    [filteredTasks, collapsedParents, effectiveSortCol, sortDir, projectNameById],
  );

  /** Flat filtered list still used for modal lookup / editor “all tasks”. */
  const tasks = filteredTasks;

  const toggleParentCollapse = (taskId: number) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const modalTaskFromList =
    modalTaskId != null ? (tasks.find((t) => t.id === modalTaskId) ?? null) : null;
  if (modalTaskFromList != null && modalTaskFromList !== modalTaskHeld) {
    setModalTaskHeld(modalTaskFromList);
  }

  useEffect(() => {
    if (!openParam || !modalTaskFromList) return;
    if (Number(openParam) !== modalTaskFromList.id) return;
    setSearchParams(
      (prev) => {
        if (!prev.has("open")) return prev;
        const next = new URLSearchParams(prev);
        next.delete("open");
        return next;
      },
      { replace: true },
    );
  }, [openParam, modalTaskFromList, setSearchParams]);

  const modalTask = modalTaskFromList ?? (modalTaskId != null ? modalTaskHeld : null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const patchTask = useMutation({
    mutationFn: async ({
      id,
      patch,
      deferHistory,
    }: {
      id: number;
      patch: Record<string, unknown>;
      deferHistory?: boolean;
    }) => {
      const res = await apiJson<{ data: Task }>(`/api/v1/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
        headers: deferHistory ? { "X-TaskMesh-History": "defer" } : undefined,
      });
      return res.data;
    },
    onSuccess: (row) => {
      qc.setQueryData<Task[]>(["tasks", "all", filter], (prev) => {
        if (!prev) return [row];
        const next = prev.map((t) => (t.id === row.id ? row : t));
        if (filter === "unassigned" && row.projectId != null) {
          return next.filter((t) => t.id !== row.id);
        }
        if (!next.some((t) => t.id === row.id)) return [...next, row];
        return next;
      });
      invalidate();
    },
  });

  const createTask = useMutation({
    mutationFn: async (title: string) => {
      const res = await apiJson<{ data: Task }>("/api/v1/tasks", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      return res.data;
    },
    onSuccess: (row) => {
      qc.setQueryData<Task[]>(["tasks", "all", filter], (prev) => {
        if (!prev) return [row];
        if (prev.some((t) => t.id === row.id)) return prev;
        return [row, ...prev];
      });
      invalidate();
      setModalTaskId(row.id);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("new");
          next.set("open", String(row.id));
          return next;
        },
        { replace: true },
      );
    },
  });

  // URL ?new=1 → prompt + create. Nonce is bumped during render when wantNew turns true;
  // this effect only talks to window / router / mutation (no sync useState).
  const createTaskMutate = createTask.mutate;
  useEffect(() => {
    if (urlCreateNonce === 0) return;
    const title = window.prompt("New task title", "Untitled task");
    if (title == null || !title.trim()) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("new");
        return next;
      });
      return;
    }
    createTaskMutate(title.trim());
  }, [urlCreateNonce, setSearchParams, createTaskMutate]);

  const headerSort = (col: string) => {
    if (!(TASK_LIST_SORT_COLS as readonly string[]).includes(col)) return;
    const sortKey = col as SortCol;
    setSort((prev) =>
      prev.col === sortKey ? { col: sortKey, dir: prev.dir === 1 ? -1 : 1 } : { col: sortKey, dir: 1 },
    );
  };

  const openModal = (id: number) => {
    setModalTaskId(id);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("open", String(id));
        return next;
      },
      { replace: true },
    );
  };

  const closeModal = () => {
    setModalTaskId(null);
    setModalTaskHeld(null);
    setHeaderActions(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("open");
        return next;
      },
      { replace: true },
    );
  };

  const startNewTask = () => {
    const title = window.prompt("New task title", "Untitled task");
    if (title == null || !title.trim()) return;
    createTask.mutate(title.trim());
  };

  if (tasksQuery.isLoading) return <p className="muted">Loading tasks…</p>;
  if (tasksQuery.error) return <p role="alert">{(tasksQuery.error as Error).message}</p>;

  return (
    <div>
      <div className="page-head">
        <h1>Tasks</h1>
        <button
          type="button"
          className="btn primary"
          disabled={createTask.isPending}
          onClick={startNewTask}
        >
          New Task
        </button>
      </div>

      <TaskListFilterBar
        filter={taskListFilter}
        onApply={applyTaskListFilter}
        onClear={clearTaskListFilter}
        includeProject
      />

      <div className="task-list task-list--global">
        <div
          className="task-list-header"
          style={{ gridTemplateColumns: gridTemplate }}
          onContextMenu={(e) => {
            e.preventDefault();
            setHeaderMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <span className="task-list-header__stripe" />
          <span />
          <span />
          <TaskListColumnHeaders
            columns={visibleColumns}
            sortCol={sortCol}
            sortDir={sortDir}
            onSort={headerSort}
            sortTrigger="click"
          />
        </div>

        {displayRows.length === 0 ? (
          <p className="muted" style={{ padding: "0.75rem 0.5rem" }}>
            {isFilterActive(taskListFilter) ? "No tasks match this filter." : "No tasks yet."}
          </p>
        ) : (
          displayRows.map(({ task, depth, hasChildren }) => {
            const showTagsInTitle = !visibleColumns.some((c) => c.fieldKey === "tags");
            return (
            <div
              key={task.id}
              className={`task-list-row${depth > 0 ? " task-list-row--child" : ""}${task.state === "complete" ? " task-list-row--complete" : ""}`}
              style={{ gridTemplateColumns: gridTemplate }}
              onDoubleClick={() => openModal(task.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({
                  x: e.clientX,
                  y: e.clientY,
                  taskId: task.id,
                  field: ctxFieldFromEventTarget(e.target),
                });
              }}
            >
              <span
                className="task-list-row__stripe"
                style={{ background: task.color ?? "transparent" }}
                aria-hidden
              />
              <span className="task-drag-handle" style={{ visibility: "hidden" }} aria-hidden>
                ::
              </span>
              <StateCheckbox
                state={task.state}
                onCycle={() => {
                  const next = nextTaskState(task.state);
                  if (next === "complete") {
                    void (async () => {
                      try {
                        const blockers = await fetchOpenDependsOn(task.id);
                        if (blockers.length > 0) {
                          setCompleteBlockMsg(formatCompleteBlockMessage(blockers));
                          return;
                        }
                        await patchTask.mutateAsync({ id: task.id, patch: { state: next } });
                      } catch (err) {
                        setCompleteBlockMsg((err as Error).message);
                      }
                    })();
                    return;
                  }
                  void patchTask.mutateAsync({
                    id: task.id,
                    patch: { state: next },
                  });
                }}
              />
              {visibleColumns.map((col) =>
                renderTaskColumnCell(col.fieldKey, {
                  task,
                  depth,
                  hasChildren,
                  collapsed: collapsedParents.has(task.id),
                  onToggleCollapse: () => toggleParentCollapse(task.id),
                  onPatch: (patch) => void patchTask.mutateAsync({ id: task.id, patch }),
                  projectName: projectLabel,
                  phaseName: phaseNameFn,
                  showTagsInTitle,
                  childIndentPx: CHILD_TITLE_INDENT_PX,
                }),
              )}
            </div>
            );
          })
        )}
      </div>

      {modalTask ? (
        <ElementShell
          mode="modal"
          entityType="task"
          title={modalTask.title}
          titleLeading={formatTaskNumber(modalTask.number)}
          showType={false}
          accentColor={modalTask.color}
          actions={headerActions}
          open
          onClose={closeModal}
        >
          <TaskEditorFields
            key={modalTask.id}
            task={modalTask}
            allTasks={tasks}
            onRequestClose={closeModal}
            onDeleted={closeModal}
            onHeaderActions={setHeaderActions}
            onOpenTask={(id) => {
              setModalTaskHeld(null);
              setModalTaskId(id);
              setSearchParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  next.set("open", String(id));
                  return next;
                },
                { replace: true },
              );
            }}
            onSavePatch={async (p, opts) => {
              const updated = await patchTask.mutateAsync({
                id: modalTask.id,
                patch: { ...p },
                deferHistory: opts?.deferHistory,
              });
              setModalTaskHeld(updated);
              return updated;
            }}
          />
        </ElementShell>
      ) : null}

      <ConfirmDialog
        open={completeBlockMsg != null}
        title="Cannot mark Complete"
        message={completeBlockMsg ?? ""}
        alertOnly
        confirmLabel="OK"
        onCancel={() => setCompleteBlockMsg(null)}
        onConfirm={() => setCompleteBlockMsg(null)}
      />

      <TaskListContextMenu
        menu={ctxMenu}
        onClose={() => setCtxMenu(null)}
        items={(() => {
          const all = tasksQuery.data ?? [];
          const ctxTask = ctxMenu ? (all.find((t) => t.id === ctxMenu.taskId) ?? null) : null;
          if (!ctxMenu || !ctxTask) return [] as TaskListContextMenuItem[];
          return [
            {
              type: "action" as const,
              label: "Move to…",
              onSelect: () => setMoveTaskId(ctxTask.id),
            },
            {
              type: "action" as const,
              label: "Set Parent…",
              onSelect: () => setParentTaskId(ctxTask.id),
            },
            {
              type: "action" as const,
              label: "Assign to…",
              onSelect: () => setAssignTaskId(ctxTask.id),
            },
          ];
        })()}
      />
      <ListViewHeaderMenu
        menu={headerMenu}
        onClose={() => setHeaderMenu(null)}
        onPersonalize={() => {
          setPersonalizeError(null);
          setPersonalizeOpen(true);
        }}
      />
      <ListViewPersonalizeModal
        open={personalizeOpen}
        title="Personalize task list"
        rows={personalizeRows}
        saving={saveListCols.isPending}
        resetting={resetListCols.isPending}
        error={personalizeError}
        onClose={() => setPersonalizeOpen(false)}
        onSave={(columns) => {
          setPersonalizeError(null);
          saveListCols.mutate(columns, {
            onSuccess: () => setPersonalizeOpen(false),
            onError: (err) => setPersonalizeError((err as Error).message),
          });
        }}
        onReset={() => {
          setPersonalizeError(null);
          resetListCols.mutate(undefined, {
            onSuccess: () => setPersonalizeOpen(false),
            onError: (err) => setPersonalizeError((err as Error).message),
          });
        }}
      />

      {(() => {
        const all = tasksQuery.data ?? [];
        const moveTask = moveTaskId != null ? (all.find((t) => t.id === moveTaskId) ?? null) : null;
        const parentTask =
          parentTaskId != null ? (all.find((t) => t.id === parentTaskId) ?? null) : null;
        const assignTask =
          assignTaskId != null ? (all.find((t) => t.id === assignTaskId) ?? null) : null;
        return (
          <>
            <MoveTaskToProjectModal
              open={moveTask != null}
              currentProjectId={moveTask?.projectId ?? null}
              onClose={() => setMoveTaskId(null)}
              onSave={async (nextProjectId) => {
                if (!moveTask) return;
                await patchTask.mutateAsync({
                  id: moveTask.id,
                  patch: { projectId: nextProjectId, phaseId: null },
                });
              }}
            />
            <SetTaskParentModal
              open={parentTask != null}
              taskId={parentTask?.id ?? 0}
              currentParentId={parentTask?.parentId ?? null}
              onClose={() => setParentTaskId(null)}
              onSave={async (nextParentId) => {
                if (!parentTask) return;
                await patchTask.mutateAsync({
                  id: parentTask.id,
                  patch: { parentId: nextParentId },
                });
              }}
            />
            <AssignToUserModal
              open={assignTask != null}
              projectId={assignTask?.projectId ?? null}
              currentAssigneeId={assignTask?.assigneeId ?? null}
              currentAssignee={assignTask?.assignee ?? null}
              onClose={() => setAssignTaskId(null)}
              onSave={async (nextAssigneeId) => {
                if (!assignTask) return;
                await patchTask.mutateAsync({
                  id: assignTask.id,
                  patch: { assigneeId: nextAssigneeId },
                });
              }}
            />
          </>
        );
      })()}
    </div>
  );
}
