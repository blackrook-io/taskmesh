import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { apiJson } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CHILD_TITLE_INDENT_PX, StateCheckbox, TaskEditorFields } from "../components/TaskBoard";
import { TaskListFilterBar } from "../components/TaskListFilterBar";
import { ElementShell } from "../components/shared/ElementShell";
import { RowTagChips } from "../components/shared/RowTagChips";
import {
  fetchOpenDependsOn,
  formatCompleteBlockMessage,
} from "../components/shared/TaskDependencyLists";
import { TaskListSortHeaderBtn } from "../components/shared/TaskListSortHeaderBtn";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATE_LABELS,
  formatTaskNumber,
  nextTaskState,
  TASK_STATE_SORT_RANK,
  taskPriorityClass,
  taskStateClass,
  type TaskPriority,
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

  const [modalTaskId, setModalTaskId] = useState<number | null>(
    openParam && Number.isFinite(Number(openParam)) ? Number(openParam) : null,
  );
  const [modalTaskHeld, setModalTaskHeld] = useState<Task | null>(null);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [completeBlockMsg, setCompleteBlockMsg] = useState<string | null>(null);
  const [collapsedParents, setCollapsedParents] = useState<Set<number>>(() => new Set());
  const sortStorageKey = storageKeyForGlobalTaskSort(filter);
  const { sortCol, sortDir, setSort } = usePersistedTaskListSort(
    sortStorageKey,
    DEFAULT_GLOBAL_TASK_LIST_SORT,
  );
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (openParam && Number.isFinite(Number(openParam))) {
      setModalTaskId(Number(openParam));
    }
  }, [openParam]);

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

  const filteredTasks = useMemo(() => {
    return evaluateTaskListFilter(tasksQuery.data ?? [], taskListFilter, filterCtx);
  }, [tasksQuery.data, taskListFilter, filterCtx]);

  const displayRows = useMemo(
    () =>
      buildGlobalDisplayRows(filteredTasks, collapsedParents, sortCol, sortDir, projectLabel),
    [filteredTasks, collapsedParents, sortCol, sortDir, projectNameById],
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
  useEffect(() => {
    if (modalTaskFromList) setModalTaskHeld(modalTaskFromList);
  }, [modalTaskFromList]);

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

  useEffect(() => {
    if (!wantNew || creating || createTask.isPending) return;
    setCreating(true);
    const title = window.prompt("New task title", "Untitled task");
    if (title == null || !title.trim()) {
      setCreating(false);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("new");
        return next;
      });
      return;
    }
    createTask.mutate(title.trim(), {
      onSettled: () => setCreating(false),
    });
  }, [wantNew, creating, createTask, setSearchParams]);

  const headerSort = (col: SortCol) => {
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 },
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
        <div className="task-list-header">
          <span className="task-list-header__stripe" />
          <span />
          <span />
          <TaskListSortHeaderBtn
            sorted={sortCol === "number"}
            dir={sortDir}
            onClick={() => headerSort("number")}
          >
            Number
          </TaskListSortHeaderBtn>
          <TaskListSortHeaderBtn
            sorted={sortCol === "title"}
            dir={sortDir}
            onClick={() => headerSort("title")}
          >
            Title
          </TaskListSortHeaderBtn>
          <TaskListSortHeaderBtn
            sorted={sortCol === "state"}
            dir={sortDir}
            onClick={() => headerSort("state")}
          >
            State
          </TaskListSortHeaderBtn>
          <TaskListSortHeaderBtn
            sorted={sortCol === "priority"}
            dir={sortDir}
            onClick={() => headerSort("priority")}
          >
            Priority
          </TaskListSortHeaderBtn>
          <TaskListSortHeaderBtn
            sorted={sortCol === "dueDate"}
            dir={sortDir}
            onClick={() => headerSort("dueDate")}
          >
            Due date
          </TaskListSortHeaderBtn>
          <TaskListSortHeaderBtn
            sorted={sortCol === "project"}
            dir={sortDir}
            onClick={() => headerSort("project")}
          >
            Project
          </TaskListSortHeaderBtn>
        </div>

        {displayRows.length === 0 ? (
          <p className="muted" style={{ padding: "0.75rem 0.5rem" }}>
            {isFilterActive(taskListFilter) ? "No tasks match this filter." : "No tasks yet."}
          </p>
        ) : (
          displayRows.map(({ task, depth, hasChildren }) => (
            <div
              key={task.id}
              className={`task-list-row${depth > 0 ? " task-list-row--child" : ""}`}
              onDoubleClick={() => openModal(task.id)}
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
              <span className="task-list-row__num">
                <span className="muted">{formatTaskNumber(task.number)}</span>
                {hasChildren ? (
                  <button
                    type="button"
                    className="task-list-row__twist"
                    aria-expanded={!collapsedParents.has(task.id)}
                    aria-label={
                      collapsedParents.has(task.id) ? "Expand child tasks" : "Collapse child tasks"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleParentCollapse(task.id);
                    }}
                  >
                    {collapsedParents.has(task.id) ? "▸" : "▾"}
                  </button>
                ) : null}
              </span>
              <span className="task-list-row__title">
                {depth > 0 ? (
                  <span
                    className="task-list-row__child-indent"
                    style={{ width: depth * CHILD_TITLE_INDENT_PX }}
                    aria-hidden
                  >
                    <span className="task-list-row__child-mark">↳</span>
                  </span>
                ) : null}
                <span className="task-list-row__title-text">{task.title}</span>
                <RowTagChips entityType="task" entityId={task.id} />
              </span>
              <span className={taskStateClass("task-list-row__state", task.state)}>
                {TASK_STATE_LABELS[task.state]}
              </span>
              <select
                className={taskPriorityClass("task-list-row__priority", task.priority)}
                value={task.priority}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  void patchTask.mutateAsync({
                    id: task.id,
                    patch: { priority: e.target.value as TaskPriority },
                  })
                }
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
                value={taskDue(task) ?? ""}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  void patchTask.mutateAsync({
                    id: task.id,
                    patch: { dueDate: e.target.value || null },
                  })
                }
                aria-label="Due date"
              />
              <span className="task-list-row__project muted" title={projectLabel(task.projectId)}>
                {projectLabel(task.projectId)}
              </span>
            </div>
          ))
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
    </div>
  );
}
