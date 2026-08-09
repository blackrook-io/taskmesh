import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MarkdownEditor } from "../components/shared/MarkdownEditor";
import { PencilIcon } from "../components/shared/PencilIcon";
import { TagInput } from "../components/shared/TagInput";
import { TaskBoard } from "../components/TaskBoard";
import { TaskListFilterBar } from "../components/TaskListFilterBar";
import { TodoListView } from "../components/TodoListView";
import { KanbanBoardsPanel } from "../components/KanbanBoardsPanel";
import { WikiPanel } from "../components/WikiPanel";
import { CanvasesPanel } from "../components/CanvasesPanel";
import { ImageBoardList } from "../components/imageBoard/ImageBoardList";
import {
  isProjectModuleKey,
  MODULE_BLURBS,
  MODULE_LABELS,
  type ProjectModuleKey,
} from "../lib/projectModules";
import { useRegisterAssistantAttach } from "../lib/assistantAttach";
import { patchTaskRecord } from "../lib/patchTask";
import { evaluateTaskListFilter, storageKeyForProjectTasks } from "../lib/taskListFilter";
import { usePersistedTaskListFilter } from "../lib/usePersistedTaskListFilter";
import type { Project, ProjectDocument, ProjectModule, ProjectPhase, Task, TodoList } from "../types";

type Tab = "overview" | "images" | "settings" | ProjectModuleKey;

const TAB_ALIASES: Record<string, Tab> = {
  overview: "overview",
  images: "images",
  settings: "settings",
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
  const [pendingDocDelete, setPendingDocDelete] = useState<number | null>(null);
  const [overviewEdit, setOverviewEdit] = useState(false);

  const invalidId = Number.isNaN(projectId);

  useRegisterAssistantAttach(
    useMemo(() => {
      if (invalidId || tab !== "overview") return null;
      return {
        key: `project-${projectId}-overview`,
        label: name.trim() || `Project #${projectId}`,
        getContext: () =>
          `Project #${projectId}\nName: ${name}\nStatus: ${status}\n\n${description}`,
      };
    }, [invalidId, tab, projectId, name, status, description]),
  );

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
  const phases = phasesQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const documents = documentsQuery.data ?? [];

  const taskListFilterKey = storageKeyForProjectTasks(projectId);
  const {
    filter: taskListFilter,
    applyFilter: applyTaskListFilter,
    clearFilter: clearTaskListFilter,
  } = usePersistedTaskListFilter(taskListFilterKey);
  const filteredTasks = useMemo(
    () => evaluateTaskListFilter(tasks, taskListFilter),
    [tasks, taskListFilter],
  );

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
  }, [project, overviewEdit]);

  useEffect(() => {
    if (!modulesQuery.isSuccess) return;
    if (tab === "overview" || tab === "images" || tab === "settings") return;
    const mod = modules.find((m) => m.moduleKey === tab);
    if (!mod?.enabled) setTab("overview");
  }, [modules, modulesQuery.isSuccess, tab]);

  const cancelOverviewEdit = () => {
    if (project) {
      setName(project.name);
      setStatus(project.status);
      setDescription(project.description ?? "");
    }
    setOverviewEdit(false);
  };

  const saveMeta = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: Project }>(`/api/v1/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ name, status, description }),
      });
      return res.data;
    },
    onSuccess: () => {
      setOverviewEdit(false);
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
    mutationFn: async (payload: {
      orderedTaskIds: number[];
      parentId?: number | null;
      phaseId?: number | null;
    }) => {
      const res = await apiJson<{ data: Task[] }>(`/api/v1/projects/${projectId}/tasks/reorder`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });

  const patchTask = useMutation({
    mutationFn: async ({ taskId, body }: { taskId: number; body: Record<string, unknown> }) => {
      return patchTaskRecord(taskId, body, projectId);
    },
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
      if (row.projectId != null && row.projectId !== projectId) {
        void qc.invalidateQueries({ queryKey: ["tasks", row.projectId] });
      }
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
      </div>

      {tab === "images" ? (
        <ImageBoardList projectId={project.id} heading="Images" />
      ) : null}

      {tab === "overview" ? (
        <div className="grid" style={{ gap: "1rem" }}>
          <div className="card">
            <div className="wiki-panel__main-head">
              <span className="sr-only">Project details</span>
              <div className="wiki-panel__main-actions" style={{ marginLeft: "auto" }}>
                {overviewEdit ? (
                  <>
                    <button type="button" className="btn small ghost" onClick={cancelOverviewEdit}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn small primary"
                      onClick={() => saveMeta.mutate()}
                      disabled={saveMeta.isPending}
                    >
                      Save overview
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn small btn-icon"
                    aria-label="Edit overview"
                    title="Edit"
                    onClick={() => setOverviewEdit(true)}
                  >
                    <PencilIcon />
                  </button>
                )}
              </div>
            </div>

            {overviewEdit ? (
              <>
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
                <div className="field field--tags-below">
                  <TagInput entityType="project" entityId={projectId} />
                </div>
                <div className="field">
                  <label>Description</label>
                  <MarkdownEditor value={description} onChange={setDescription} height={280} />
                </div>
              </>
            ) : (
              <>
                <h1 className="wiki-page-title">{project.name}</h1>
                <p className="muted" style={{ marginTop: "-0.35rem", marginBottom: "0.75rem" }}>
                  {project.status}
                </p>
                <div className="field field--tags-below">
                  <TagInput entityType="project" entityId={projectId} readOnly />
                </div>
                <MarkdownEditor value={description} onChange={() => undefined} height={280} readOnly />
              </>
            )}
            {saveMeta.isError ? <p role="alert">{(saveMeta.error as Error).message}</p> : null}
          </div>

          {modules.some((m) => m.enabled && isProjectModuleKey(m.moduleKey)) ? (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Enabled views</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Jump to modules enabled for this project. Turn others on in Settings.
              </p>
              <div className="btn-row" style={{ flexWrap: "wrap" }}>
                {modules
                  .filter((m) => m.enabled && isProjectModuleKey(m.moduleKey))
                  .map((m) => {
                    const key = m.moduleKey as ProjectModuleKey;
                    return (
                      <button
                        key={key}
                        type="button"
                        className="btn small"
                        onClick={() => setTab(key)}
                      >
                        {MODULE_LABELS[key]}
                      </button>
                    );
                  })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "settings" ? (
        <>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Project modules</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Enable the pieces this project needs. Disabled modules stay Settings-only until enabled —
            they do not appear in the project middle nav.
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
                          onClick={() => toggleModule.mutate({ key, enabled: true })}
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
        <div className="card" style={{ marginTop: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Danger zone</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Deleting this project permanently removes its tasks, documents, phases, and other project
            content. This cannot be undone.
          </p>
          <button type="button" className="btn danger" onClick={() => setDeleteProjectOpen(true)}>
            Delete project
          </button>
        </div>
        </>
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
          <TaskListFilterBar
            filter={taskListFilter}
            onApply={applyTaskListFilter}
            onClear={clearTaskListFilter}
          />
          <div style={{ marginTop: "0.5rem" }}>
            <TaskBoard
              projectId={projectId}
              phases={phases}
              tasks={filteredTasks}
              onReorder={async (payload) => {
                await reorderTasks.mutateAsync(payload);
              }}
              onReorderPhases={async (orderedPhaseIds) => {
                await apiJson(`/api/v1/projects/${projectId}/phases/reorder`, {
                  method: "PATCH",
                  body: JSON.stringify({ orderedPhaseIds }),
                });
                void qc.invalidateQueries({ queryKey: ["phases", projectId] });
                void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
              }}
              onRenamePhase={async (phaseId, name) => {
                await apiJson(`/api/v1/projects/${projectId}/phases/${phaseId}`, {
                  method: "PATCH",
                  body: JSON.stringify({ name }),
                });
                void qc.invalidateQueries({ queryKey: ["phases", projectId] });
              }}
              onCreatePhase={async (name) => {
                await apiJson(`/api/v1/projects/${projectId}/phases`, {
                  method: "POST",
                  body: JSON.stringify({ name }),
                });
                void qc.invalidateQueries({ queryKey: ["phases", projectId] });
              }}
              onDeletePhase={async (phaseId) => {
                await apiJson(`/api/v1/projects/${projectId}/phases/${phaseId}`, {
                  method: "DELETE",
                });
                void qc.invalidateQueries({ queryKey: ["phases", projectId] });
                void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
              }}
              onPatchTask={async (taskId, patch) => {
                return patchTask.mutateAsync({ taskId, body: patch });
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
        <div className="split-panel">
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

      {tab === "canvases" ? <CanvasesPanel projectId={projectId} /> : null}

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

  useRegisterAssistantAttach(
    useMemo(
      () => ({
        key: `document-${doc.id}`,
        label: title.trim() || `Document #${doc.id}`,
        getContext: () =>
          `Document #${doc.id} (project #${doc.projectId})\nTitle: ${title}\n\n${body}`,
      }),
      [doc.id, doc.projectId, title, body],
    ),
  );

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
