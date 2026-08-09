import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { apiJson } from "../api/client";
import { StateCheckbox, TaskEditorFields } from "../components/TaskBoard";
import { ElementShell } from "../components/shared/ElementShell";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATE_LABELS,
  formatTaskNumber,
  nextTaskState,
  taskStateClass,
  type TaskPriority,
} from "../lib/taskFields";
import type { Project, ProjectPhase, Task } from "../types";

type SortCol = "number" | "title" | "state" | "priority" | "dueDate" | "project";

function taskDue(task: Task): string | null {
  return task.dueDate ?? (task.dueAt ? task.dueAt.slice(0, 10) : null);
}

function sortTasks(list: Task[], col: SortCol | null, dir: 1 | -1, projectName: (id: number | null) => string) {
  if (!col) return list;
  const stateRank: Record<Task["state"], number> = {
    new: 0,
    in_progress: 1,
    on_hold: 2,
    complete: 3,
    canceled: 4,
  };
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
  const [sortCol, setSortCol] = useState<SortCol | null>("number");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
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

  const tasks = useMemo(
    () => sortTasks(tasksQuery.data ?? [], sortCol, sortDir, projectLabel),
    [tasksQuery.data, sortCol, sortDir, projectNameById],
  );

  const modalTaskFromList =
    modalTaskId != null ? (tasks.find((t) => t.id === modalTaskId) ?? null) : null;
  useEffect(() => {
    if (modalTaskFromList) setModalTaskHeld(modalTaskFromList);
  }, [modalTaskFromList]);
  const modalTask = modalTaskFromList ?? (modalTaskId != null ? modalTaskHeld : null);

  const phasesQuery = useQuery({
    queryKey: ["phases", modalTask?.projectId],
    enabled: modalTask?.projectId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: ProjectPhase[] }>(
        `/api/v1/projects/${modalTask!.projectId}/phases`,
      );
      return res.data;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const patchTask = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Record<string, unknown> }) => {
      const res = await apiJson<{ data: Task }>(`/api/v1/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
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
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("new");
        next.set("open", String(row.id));
        return next;
      });
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
    if (sortCol === col) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortCol(col);
      setSortDir(1);
    }
  };

  const openModal = (id: number) => {
    setModalTaskId(id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("open", String(id));
      return next;
    });
  };

  const closeModal = () => {
    setModalTaskId(null);
    setModalTaskHeld(null);
    setHeaderActions(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("open");
      return next;
    });
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

      <div className="task-list task-list--global">
        <div className="task-list-header">
          <span className="task-list-header__stripe" />
          <span />
          <span />
          <button type="button" className="task-list-header__btn" onClick={() => headerSort("number")}>
            Number
          </button>
          <button type="button" className="task-list-header__btn" onClick={() => headerSort("title")}>
            Title
          </button>
          <button type="button" className="task-list-header__btn" onClick={() => headerSort("state")}>
            State
          </button>
          <button type="button" className="task-list-header__btn" onClick={() => headerSort("priority")}>
            Priority
          </button>
          <button type="button" className="task-list-header__btn" onClick={() => headerSort("dueDate")}>
            Date
          </button>
          <button type="button" className="task-list-header__btn" onClick={() => headerSort("project")}>
            Project
          </button>
        </div>

        {tasks.length === 0 ? (
          <p className="muted" style={{ padding: "0.75rem 0.5rem" }}>
            No tasks yet.
          </p>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              className={`task-list-row${task.parentId != null ? " task-list-row--child" : ""}`}
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
                onCycle={() =>
                  void patchTask.mutateAsync({
                    id: task.id,
                    patch: { state: nextTaskState(task.state) },
                  })
                }
              />
              <span className="task-list-row__num muted">
                {task.parentId != null ? "↳ " : ""}
                {formatTaskNumber(task.number)}
              </span>
              <span className="task-list-row__title">{task.title}</span>
              <span className={taskStateClass("task-list-row__state", task.state)}>
                {TASK_STATE_LABELS[task.state]}
              </span>
              <select
                className="task-list-row__priority"
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
            phases={phasesQuery.data ?? []}
            allTasks={tasks}
            onRequestClose={closeModal}
            onDeleted={closeModal}
            onHeaderActions={setHeaderActions}
            onSavePatch={async (p) => {
              const updated = await patchTask.mutateAsync({ id: modalTask.id, patch: { ...p } });
              setModalTaskHeld(updated);
              return updated;
            }}
          />
        </ElementShell>
      ) : null}
    </div>
  );
}
