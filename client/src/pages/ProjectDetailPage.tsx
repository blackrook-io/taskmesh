import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MarkdownEditor } from "../components/shared/MarkdownEditor";
import { TagInput } from "../components/shared/TagInput";
import { PhaseManager } from "../components/PhaseManager";
import { TaskBoard } from "../components/TaskBoard";
import { TodoListView } from "../components/TodoListView";
import { KanbanBoardsPanel } from "../components/KanbanBoardsPanel";
import { WikiPanel } from "../components/WikiPanel";
import {
  IMPLEMENTED_MODULES,
  isProjectModuleKey,
  MODULE_BLURBS,
  MODULE_LABELS,
  type ProjectModuleKey,
} from "../lib/projectModules";
import type { Project, ProjectDocument, ProjectModule, ProjectPhase, Task, TodoList } from "../types";

type Tab = "overview" | ProjectModuleKey;

const TAB_ALIASES: Record<string, Tab> = {
  overview: "overview",
  todos: "todo_lists",
  todo_lists: "todo_lists",
  tasks: "tasks",
  documents: "documents",
  boards: "boards",
  wiki: "wiki",
  canvases: "canvases",
};

function parseTab(raw: string | null): Tab {
  if (!raw) return "overview";
  return TAB_ALIASES[raw] ?? "overview";
}

export function ProjectDetailPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const tab = parseTab(searchParams.get("tab"));
  const setTab = (next: Tab) => {
    if (next === "overview") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: next }, { replace: true });
    }
  };

  const [name, setName] = useState("");
  const [status, setStatus] = useState("idea");
  const [description, setDescription] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [projectListId, setProjectListId] = useState<number | null>(null);
  const [newTodoListTitle, setNewTodoListTitle] = useState("");

  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [pendingTaskDelete, setPendingTaskDelete] = useState<number | null>(null);
  const [pendingDocDelete, setPendingDocDelete] = useState<number | null>(null);

  const invalidId = Number.isNaN(projectId);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    enabled: !invalidId,
    queryFn: async () => {
      const res = await apiJson<{ data: Project }>(`/api/v1/projects/${projectId}`);
      return res.data;
    },
  });

  const modulesQuery = useQuery({
    queryKey: ["project-modules", projectId],
    enabled: !invalidId,
    queryFn: async () => {
      const res = await apiJson<{ data: ProjectModule[] }>(
        `/api/v1/projects/${projectId}/modules`,
      );
      return res.data;
    },
  });

  const phasesQuery = useQuery({
    queryKey: ["phases", projectId],
    enabled: !invalidId,
    queryFn: async () => {
      const res = await apiJson<{ data: ProjectPhase[] }>(`/api/v1/projects/${projectId}/phases`);
      return res.data;
    },
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks", projectId],
    enabled: !invalidId,
    queryFn: async () => {
      const res = await apiJson<{ data: Task[] }>(`/api/v1/projects/${projectId}/tasks`);
      return res.data;
    },
  });

  const documentsQuery = useQuery({
    queryKey: ["documents", projectId],
    enabled: !invalidId,
    queryFn: async () => {
      const res = await apiJson<{ data: ProjectDocument[] }>(`/api/v1/projects/${projectId}/documents`);
      return res.data;
    },
  });

  const todoListsQuery = useQuery({
    queryKey: ["todo-lists", projectId],
    enabled: !invalidId,
    queryFn: async () => {
      const res = await apiJson<{ data: TodoList[] }>(
        `/api/v1/todo-lists?projectId=${projectId}`,
      );
      return res.data;
    },
  });

  const createTodoList = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: TodoList }>("/api/v1/todo-lists", {
        method: "POST",
        body: JSON.stringify({ title: newTodoListTitle.trim(), projectId }),
      });
      return res.data;
    },
    onSuccess: (list) => {
      setNewTodoListTitle("");
      setProjectListId(list.id);
      void qc.invalidateQueries({ queryKey: ["todo-lists", projectId] });
    },
  });

  const toggleModule = useMutation({
    mutationFn: async ({ key, enabled }: { key: ProjectModuleKey; enabled: boolean }) => {
      const res = await apiJson<{ data: ProjectModule }>(
        `/api/v1/projects/${projectId}/modules/${key}`,
        { method: "PATCH", body: JSON.stringify({ enabled }) },
      );
      return res.data;
    },
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ["project-modules", projectId] });
      if (!row.enabled && tab === row.moduleKey) {
        setTab("overview");
      }
    },
  });

  const project = projectQuery.data;
  const modules = modulesQuery.data ?? [];
  const enabledModules = useMemo(
    () =>
      modules
        .filter((m) => m.enabled && isProjectModuleKey(m.moduleKey))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [modules],
  );
  const phases = phasesQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const documents = documentsQuery.data ?? [];

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) ?? null,
    [documents, selectedDocId],
  );

  useEffect(() => {
    if (project) {
      setName(project.name);
      setStatus(project.status);
      setDescription(project.description ?? "");
    }
  }, [project]);

  useEffect(() => {
    if (!modulesQuery.isSuccess) return;
    if (tab === "overview") return;
    const mod = modules.find((m) => m.moduleKey === tab);
    if (!mod?.enabled) setTab("overview");
  }, [modules, modulesQuery.isSuccess, tab]);

  const saveMeta = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: Project }>(`/api/v1/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ name, status, description }),
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const deleteProject = useMutation({
    mutationFn: async () => {
      await apiJson(`/api/v1/projects/${projectId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      navigate("/projects");
    },
  });

  const createTask = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: Task }>(`/api/v1/projects/${projectId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title: newTaskTitle }),
      });
      return res.data;
    },
    onSuccess: () => {
      setNewTaskTitle("");
      void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });

  const reorderTasks = useMutation({
    mutationFn: async (orderedTaskIds: number[]) => {
      const res = await apiJson<{ data: Task[] }>(`/api/v1/projects/${projectId}/tasks/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ orderedTaskIds }),
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });

  const patchTask = useMutation({
    mutationFn: async ({ taskId, body }: { taskId: number; body: Record<string, unknown> }) => {
      const res = await apiJson<{ data: Task }>(`/api/v1/projects/${projectId}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });

  const deleteTask = useMutation({
    mutationFn: async (taskId: number) => {
      await apiJson(`/api/v1/projects/${projectId}/tasks/${taskId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });

  const createDocument = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: ProjectDocument }>(`/api/v1/projects/${projectId}/documents`, {
        method: "POST",
        body: JSON.stringify({ title: newDocTitle, body: "" }),
      });
      return res.data;
    },
    onSuccess: (doc) => {
      setNewDocTitle("");
      setSelectedDocId(doc.id);
      void qc.invalidateQueries({ queryKey: ["documents", projectId] });
    },
  });

  const saveDocument = useMutation({
    mutationFn: async ({ docId, title, body }: { docId: number; title: string; body: string }) => {
      const res = await apiJson<{ data: ProjectDocument }>(`/api/v1/projects/${projectId}/documents/${docId}`, {
        method: "PATCH",
        body: JSON.stringify({ title, body }),
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents", projectId] });
    },
  });

  const deleteDocument = useMutation({
    mutationFn: async (docId: number) => {
      await apiJson(`/api/v1/projects/${projectId}/documents/${docId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      setSelectedDocId(null);
      void qc.invalidateQueries({ queryKey: ["documents", projectId] });
    },
  });

  if (invalidId) return <p className="muted">Invalid project id.</p>;
  if (projectQuery.isLoading) return <p className="muted">Loading project…</p>;
  if (projectQuery.error) return <p role="alert">{(projectQuery.error as Error).message}</p>;
  if (!project) return <p className="muted">Project not found.</p>;

  return (
    <div>
      <div className="page-head">
        <h1>{project.name}</h1>
        <div className="btn-row">
          <Link to="/projects" className="btn ghost">
            All projects
          </Link>
          <button type="button" className="btn danger" onClick={() => setDeleteProjectOpen(true)}>
            Delete project
          </button>
        </div>
      </div>

      <div className="tabs">
        <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
          Overview
        </button>
        {enabledModules.map((m) => {
          const key = m.moduleKey as ProjectModuleKey;
          return (
            <button
              key={key}
              type="button"
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              {MODULE_LABELS[key]}
            </button>
          );
        })}
      </div>

      {tab === "overview" ? (
        <div className="grid" style={{ gap: "1rem" }}>
          <div className="card">
            <div className="field">
              <label htmlFor="proj-name">Name</label>
              <input id="proj-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="proj-status">Status</label>
              <select id="proj-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="idea">idea</option>
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="done">done</option>
              </select>
            </div>
            <div className="field">
              <label>Description</label>
              <MarkdownEditor value={description} onChange={setDescription} height={280} />
            </div>
            <div className="field field--tags-below">
              <TagInput entityType="project" entityId={projectId} />
            </div>
            <button type="button" className="btn primary" onClick={() => saveMeta.mutate()} disabled={saveMeta.isPending}>
              Save overview
            </button>
            {saveMeta.isError ? <p role="alert">{(saveMeta.error as Error).message}</p> : null}
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Project modules</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Enable the pieces this project needs. Disabled modules stay available as opportunities below.
            </p>
            <div className="module-hub">
              {modules
                .filter((m) => isProjectModuleKey(m.moduleKey))
                .map((m) => {
                  const key = m.moduleKey as ProjectModuleKey;
                  return (
                    <div key={key} className={`module-hub__item${m.enabled ? " is-enabled" : ""}`}>
                      <div className="module-hub__copy">
                        <strong>{MODULE_LABELS[key]}</strong>
                        <span className="muted">{MODULE_BLURBS[key]}</span>
                      </div>
                      <div className="module-hub__actions">
                        {m.enabled ? (
                          <>
                            <button type="button" className="btn small primary" onClick={() => setTab(key)}>
                              Open
                            </button>
                            <button
                              type="button"
                              className="btn small ghost"
                              disabled={toggleModule.isPending}
                              onClick={() => toggleModule.mutate({ key, enabled: false })}
                            >
                              Disable
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn small primary"
                            disabled={toggleModule.isPending}
                            onClick={() => {
                              toggleModule.mutate(
                                { key, enabled: true },
                                { onSuccess: () => setTab(key) },
                              );
                            }}
                          >
                            Enable
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "tasks" ? (
        <div>
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>New task</label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Task title"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newTaskTitle.trim() && !createTask.isPending) {
                      e.preventDefault();
                      createTask.mutate();
                    }
                  }}
                  style={{ flex: 1, minWidth: "200px" }}
                />
                <button
                  type="button"
                  className="btn primary"
                  disabled={!newTaskTitle.trim() || createTask.isPending}
                  onClick={() => createTask.mutate()}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
          <PhaseManager projectId={projectId} phases={phases} />
          <div style={{ marginTop: "1rem" }}>
            <TaskBoard
              phases={phases}
              tasks={tasks}
              onReorder={async (orderedTaskIds) => {
                await reorderTasks.mutateAsync(orderedTaskIds);
              }}
              onPatchTask={async (taskId, patch) => {
                await patchTask.mutateAsync({ taskId, body: patch });
              }}
              onDeleteTask={async (taskId) => {
                setPendingTaskDelete(taskId);
              }}
            />
          </div>
          {reorderTasks.isError ? <p role="alert">{(reorderTasks.error as Error).message}</p> : null}
        </div>
      ) : null}

      {tab === "todo_lists" ? (
        <div>
          <div className="card" style={{ marginBottom: "1rem" }}>
            <h3>Project To Do lists</h3>
            <div className="btn-row" style={{ marginBottom: "0.75rem", flexWrap: "wrap" }}>
              {(todoListsQuery.data ?? []).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`btn small${(projectListId ?? todoListsQuery.data?.[0]?.id) === l.id ? " primary" : " ghost"}`}
                  onClick={() => setProjectListId(l.id)}
                >
                  {l.title}
                </button>
              ))}
            </div>
            <div className="todo-add-row">
              <input
                type="text"
                placeholder="New list for this project"
                value={newTodoListTitle}
                onChange={(e) => setNewTodoListTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTodoListTitle.trim()) createTodoList.mutate();
                }}
              />
              <button
                type="button"
                className="btn primary"
                disabled={!newTodoListTitle.trim() || createTodoList.isPending}
                onClick={() => createTodoList.mutate()}
              >
                Create list
              </button>
            </div>
          </div>
          {(projectListId ?? todoListsQuery.data?.[0]?.id) != null ? (
            <div className="card">
              <TodoListView
                listId={(projectListId ?? todoListsQuery.data![0]!.id)!}
                defaultProjectId={projectId}
              />
            </div>
          ) : (
            <p className="muted">Create a To Do list for this project to get started.</p>
          )}
        </div>
      ) : null}

      {tab === "documents" ? (
        <div className="grid" style={{ gridTemplateColumns: "minmax(200px, 260px) 1fr", alignItems: "start" }}>
          <div className="card">
            <h3>Documents</h3>
            <div className="field">
              <label>New document title</label>
              <input type="text" value={newDocTitle} onChange={(e) => setNewDocTitle(e.target.value)} />
            </div>
            <button
              type="button"
              className="btn primary"
              style={{ width: "100%", marginBottom: "0.75rem" }}
              disabled={!newDocTitle.trim() || createDocument.isPending}
              onClick={() => createDocument.mutate()}
            >
              Create
            </button>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {documents.map((d) => (
                <li key={d.id} style={{ marginBottom: "0.35rem" }}>
                  <button
                    type="button"
                    className={`btn small${selectedDocId === d.id ? " primary" : " ghost"}`}
                    style={{ width: "100%", justifyContent: "flex-start" }}
                    onClick={() => setSelectedDocId(d.id)}
                  >
                    {d.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            {selectedDoc ? (
              <DocumentEditor
                key={selectedDoc.id}
                doc={selectedDoc}
                onSave={(title, body) => saveDocument.mutate({ docId: selectedDoc.id, title, body })}
                onDelete={() => setPendingDocDelete(selectedDoc.id)}
                busy={saveDocument.isPending}
              />
            ) : (
              <p className="muted">Select or create a document.</p>
            )}
          </div>
        </div>
      ) : null}

      {tab === "boards" ? <KanbanBoardsPanel projectId={projectId} phases={phases} /> : null}

      {tab === "wiki" ? <WikiPanel projectId={projectId} /> : null}

      {tab === "canvases" ? (
        <div className="card module-placeholder">
          <h2 style={{ marginTop: 0 }}>{MODULE_LABELS[tab]}</h2>
          <p>{MODULE_BLURBS[tab]}</p>
          <p className="muted">
            This module is enabled for the project hub. Full UI lands in a later phase — deep link{" "}
            <code>?tab={tab}</code> already works.
          </p>
          {!IMPLEMENTED_MODULES.has(tab) ? (
            <button type="button" className="btn ghost" onClick={() => setTab("overview")}>
              Back to overview
            </button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteProjectOpen}
        title="Delete project?"
        message="This removes tasks, documents, and phases for this project."
        onCancel={() => setDeleteProjectOpen(false)}
        onConfirm={() => {
          setDeleteProjectOpen(false);
          deleteProject.mutate();
        }}
      />

      <ConfirmDialog
        open={pendingTaskDelete != null}
        title="Delete task?"
        message="This cannot be undone."
        onCancel={() => setPendingTaskDelete(null)}
        onConfirm={() => {
          const tid = pendingTaskDelete;
          setPendingTaskDelete(null);
          if (tid != null) void deleteTask.mutateAsync(tid);
        }}
      />

      <ConfirmDialog
        open={pendingDocDelete != null}
        title="Delete document?"
        message="This cannot be undone."
        onCancel={() => setPendingDocDelete(null)}
        onConfirm={() => {
          const did = pendingDocDelete;
          setPendingDocDelete(null);
          if (did != null) void deleteDocument.mutateAsync(did);
        }}
      />
    </div>
  );
}

function DocumentEditor({
  doc,
  onSave,
  onDelete,
  busy,
}: {
  doc: ProjectDocument;
  onSave: (title: string, body: string) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body ?? "");

  return (
    <div>
      <div className="page-head">
        <h2 style={{ margin: 0 }}>Edit document</h2>
        <button type="button" className="btn danger small" onClick={onDelete}>
          Delete
        </button>
      </div>
      <div className="field">
        <label htmlFor="doc-title">Title</label>
        <input id="doc-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label>Tags</label>
        <TagInput entityType="document" entityId={doc.id} />
      </div>
      <div className="field">
        <label>Body</label>
        <MarkdownEditor value={body} onChange={setBody} height={420} />
      </div>
      <button type="button" className="btn primary" disabled={busy} onClick={() => onSave(title, body)}>
        Save document
      </button>
    </div>
  );
}
