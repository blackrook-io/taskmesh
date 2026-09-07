import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiJson, uploadFileWithMeta } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EpubReader } from "../components/EpubReader";
import { PdfReader } from "../components/PdfReader";
import { MarkdownEditor } from "../components/shared/MarkdownEditor";
import { DocumentKindIcon } from "../components/shared/DocumentKindIcon";
import { PencilIcon } from "../components/shared/PencilIcon";
import { TagInput } from "../components/shared/TagInput";
import { PhaseManager } from "../components/PhaseManager";
import { TaskBoard } from "../components/TaskBoard";
import { TaskListFilterBar } from "../components/TaskListFilterBar";
import { TodoListTabBar } from "../components/TodoListTabBar";
import { TodoListView } from "../components/TodoListView";
import { KanbanBoardsPanel } from "../components/KanbanBoardsPanel";
import { WikiPanel } from "../components/WikiPanel";
import { CanvasesPanel } from "../components/CanvasesPanel";
import { DocumentsToc } from "../components/DocumentsToc";
import { ImageBoardList } from "../components/imageBoard/ImageBoardList";
import {
  isProjectModuleKey,
  MODULE_BLURBS,
  MODULE_LABELS,
  type ProjectModuleKey,
} from "../lib/projectModules";
import { useRegisterAssistantAttach } from "../lib/assistantAttach";
import { patchTaskRecord } from "../lib/patchTask";
import { formatEntityRef } from "../lib/entityRef";
import { resolveEpubDocumentTitle } from "../lib/epubMeta";
import { resolvePdfDocumentTitle } from "../lib/pdfMeta";
import { sanitizePlainText } from "../lib/plainText";
import { storageKeyForProjectTasks, emptyTaskListFilter, isFilterActive, parseTaskListFilterValue } from "../lib/taskListFilter";
import { usePersistedTaskListFilter } from "../lib/usePersistedTaskListFilter";
import type {
  Project,
  ProjectDocument,
  ProjectModule,
  ProjectPhase,
  Task,
  TaskGroup,
  TodoList,
  TodoListDetail,
} from "../types";

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

const PROJECT_STATUS_OPTIONS = [
  { value: "idea", label: "Idea" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "done", label: "Done" },
] as const;

function projectStatusLabel(status: string): string {
  const hit = PROJECT_STATUS_OPTIONS.find((o) => o.value === status);
  if (hit) return hit.label;
  if (!status) return status;
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function parseIdParam(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function ProjectDetailPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const tab = parseTab(searchParams.get("tab"));
  const groupParam = parseIdParam(searchParams.get("group"));
  const initialDocId = parseIdParam(searchParams.get("doc"));
  const initialBoardId = parseIdParam(searchParams.get("board"));
  const initialCanvasId = parseIdParam(searchParams.get("canvas"));
  const initialNodeId = parseIdParam(searchParams.get("node"));
  const openTaskId = parseIdParam(searchParams.get("open"));

  const clearSearchParam = useCallback(
    (key: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

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
  const [requestOpenTask, setRequestOpenTask] = useState<Task | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [epubUploadError, setEpubUploadError] = useState<string | null>(null);
  const [pdfUploadError, setPdfUploadError] = useState<string | null>(null);
  const epubFileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfFileInputRef = useRef<HTMLInputElement | null>(null);
  const [projectListId, setProjectListId] = useState<number | null>(null);
  const [pendingDeleteTodoList, setPendingDeleteTodoList] = useState<TodoList | null>(null);

  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [pendingDocDelete, setPendingDocDelete] = useState<number | null>(null);
  const [overviewEdit, setOverviewEdit] = useState(false);
  /** One-shot guards so URL-driven open/doc apply once per param value. */
  const [appliedDocParam, setAppliedDocParam] = useState<number | null>(null);
  const [appliedOpenParam, setAppliedOpenParam] = useState<number | null>(null);
  const [boundProjectId, setBoundProjectId] = useState(projectId);

  const invalidId = Number.isNaN(projectId);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    enabled: !invalidId,
    queryFn: async () => {
      const res = await apiJson<{ data: Project }>(`/api/v1/projects/${projectId}`);
      return res.data;
    },
  });

  const overviewName = overviewEdit ? name : (projectQuery.data?.name ?? "");
  const overviewStatus = overviewEdit ? status : (projectQuery.data?.status ?? "idea");
  const overviewDescription = overviewEdit
    ? description
    : (projectQuery.data?.description ?? "");

  useRegisterAssistantAttach(
    useMemo(() => {
      if (invalidId || tab !== "overview") return null;
      return {
        key: `project-${projectId}-overview`,
        label: overviewName.trim() || `Project #${projectId}`,
        getContext: () =>
          `Project #${projectId}\nName: ${overviewName}\nStatus: ${overviewStatus}\n\n${overviewDescription}`,
      };
    }, [invalidId, tab, projectId, overviewName, overviewStatus, overviewDescription]),
  );

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

  const groupsQuery = useQuery({
    queryKey: ["task-groups", projectId],
    enabled: !invalidId,
    queryFn: async () => {
      const res = await apiJson<{ data: TaskGroup[] }>(`/api/v1/projects/${projectId}/groups`);
      return res.data;
    },
  });

  const phasesQuery = useQuery({
    queryKey: ["project-phases", projectId],
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

  const projectTodoLists = useMemo(
    () => todoListsQuery.data ?? [],
    [todoListsQuery.data],
  );

  const todoListItemCountQueries = useQueries({
    queries: projectTodoLists.map((l) => ({
      queryKey: ["todo-list", l.id],
      queryFn: async () => {
        const res = await apiJson<{ data: TodoListDetail }>(`/api/v1/todo-lists/${l.id}`);
        return res.data.items.length;
      },
      staleTime: 30_000,
    })),
  });

  const todoListItemCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    projectTodoLists.forEach((list, index) => {
      const count = todoListItemCountQueries[index]?.data;
      if (count !== undefined) counts[list.id] = count;
    });
    return counts;
  }, [projectTodoLists, todoListItemCountQueries]);

  const createTodoList = useMutation({
    mutationFn: async (title: string) => {
      const res = await apiJson<{ data: TodoList }>("/api/v1/todo-lists", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), projectId }),
      });
      return res.data;
    },
    onSuccess: (list) => {
      setProjectListId(list.id);
      void qc.invalidateQueries({ queryKey: ["todo-lists", projectId] });
    },
  });

  const renameTodoList = useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) => {
      const res = await apiJson<{ data: TodoList }>(`/api/v1/todo-lists/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.trim() }),
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["todo-lists", projectId] });
    },
  });

  const deleteTodoList = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/todo-lists/${id}`, { method: "DELETE" });
    },
    onSuccess: (_data, deletedId) => {
      setPendingDeleteTodoList(null);
      void qc.invalidateQueries({ queryKey: ["todo-lists", projectId] });
      void qc.removeQueries({ queryKey: ["todo-list", deletedId] });
      setProjectListId((current) => {
        if (current !== deletedId) return current;
        const lists = qc.getQueryData<TodoList[]>(["todo-lists", projectId]) ?? [];
        const remaining = lists.filter((l) => l.id !== deletedId);
        return remaining[0]?.id ?? null;
      });
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
  const modules = useMemo(() => modulesQuery.data ?? [], [modulesQuery.data]);
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const tasks = tasksQuery.data ?? [];
  const documents = useMemo(() => documentsQuery.data ?? [], [documentsQuery.data]);

  const taskListFilterKey = storageKeyForProjectTasks(projectId);
  const {
    filter: taskListFilter,
    applyFilter: applyTaskListFilter,
    clearFilter: clearTaskListFilter,
  } = usePersistedTaskListFilter(taskListFilterKey);

  const navListView = tab === "tasks" && groupParam != null;

  const navGroup = useMemo(() => {
    if (!navListView) return null;
    return groups.find((g) => g.id === groupParam) ?? null;
  }, [navListView, groupParam, groups]);

  const navGroupFilter = useMemo(() => {
    if (!navGroup) return null;
    const parsed = parseTaskListFilterValue(navGroup.filter);
    if (!parsed || !isFilterActive(parsed)) return null;
    return parsed;
  }, [navGroup]);

  const displayedTaskListFilter = navListView
    ? (navGroupFilter ?? emptyTaskListFilter())
    : taskListFilter;

  useEffect(() => {
    if (!navListView || groupParam == null || !groupsQuery.isSuccess) return;
    if (groups.some((g) => g.id === groupParam)) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("group");
        return next;
      },
      { replace: true },
    );
  }, [navListView, groupParam, groups, groupsQuery.isSuccess, setSearchParams]);

  const takeOverListFilter = (next: typeof taskListFilter | "clear") => {
    if (next === "clear") clearTaskListFilter();
    else applyTaskListFilter(next);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete("group");
        return params;
      },
      { replace: true },
    );
  };

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) ?? null,
    [documents, selectedDocId],
  );

  // Disabled-module tab → overview (router sync only).
  useEffect(() => {
    if (!modulesQuery.isSuccess) return;
    if (tab === "overview" || tab === "images" || tab === "settings") return;
    const mod = modules.find((m) => m.moduleKey === tab);
    if (mod?.enabled) return;
    setSearchParams({}, { replace: true });
  }, [modules, modulesQuery.isSuccess, tab, setSearchParams]);

  // Adopt ?doc= once the document list includes it.
  if (initialDocId == null) {
    if (appliedDocParam != null) setAppliedDocParam(null);
  } else if (
    tab === "documents" &&
    appliedDocParam !== initialDocId &&
    documents.some((d) => d.id === initialDocId)
  ) {
    setAppliedDocParam(initialDocId);
    setSelectedDocId(initialDocId);
  }

  useEffect(() => {
    if (initialDocId == null || appliedDocParam !== initialDocId) return;
    if (!searchParams.has("doc")) return;
    clearSearchParam("doc");
  }, [initialDocId, appliedDocParam, searchParams, clearSearchParam]);

  // Adopt ?open= once the task list includes it.
  if (openTaskId == null) {
    if (appliedOpenParam != null) setAppliedOpenParam(null);
  } else if (tab === "tasks" && appliedOpenParam !== openTaskId) {
    const task = tasks.find((t) => t.id === openTaskId);
    if (task) {
      setAppliedOpenParam(openTaskId);
      setRequestOpenTask(task);
    }
  }

  useEffect(() => {
    if (openTaskId == null || appliedOpenParam !== openTaskId) return;
    if (!searchParams.has("open")) return;
    clearSearchParam("open");
  }, [openTaskId, appliedOpenParam, searchParams, clearSearchParam]);

  if (boundProjectId !== projectId) {
    setBoundProjectId(projectId);
    setAppliedDocParam(null);
    setAppliedOpenParam(null);
    setSelectedDocId(null);
    setRequestOpenTask(null);
    setOverviewEdit(false);
  }

  const beginOverviewEdit = () => {
    if (project) {
      setName(project.name);
      setStatus(project.status);
      setDescription(project.description ?? "");
    }
    setOverviewEdit(true);
  };

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
    onSuccess: (row) => {
      setNewTaskTitle("");
      setRequestOpenTask(row);
      qc.setQueryData<Task[]>(["tasks", projectId], (prev) => {
        if (!prev) return [row];
        if (prev.some((t) => t.id === row.id)) return prev;
        return [...prev, row];
      });
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
    mutationFn: async ({
      taskId,
      body,
      deferHistory,
    }: {
      taskId: number;
      body: Record<string, unknown>;
      deferHistory?: boolean;
    }) => {
      return patchTaskRecord(taskId, body, projectId, { deferHistory });
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
        body: JSON.stringify({ title: "Untitled", body: "", kind: "markdown" }),
      });
      return res.data;
    },
    onSuccess: (doc) => {
      setSelectedDocId(doc.id);
      void qc.invalidateQueries({ queryKey: ["documents", projectId] });
    },
  });

  const createEpubDocument = useMutation({
    mutationFn: async (file: File) => {
      const [upload, title] = await Promise.all([
        uploadFileWithMeta(file),
        resolveEpubDocumentTitle(file),
      ]);
      const res = await apiJson<{ data: ProjectDocument }>(`/api/v1/projects/${projectId}/documents`, {
        method: "POST",
        body: JSON.stringify({ title, kind: "epub", uploadId: upload.id }),
      });
      return res.data;
    },
    onSuccess: (doc) => {
      setEpubUploadError(null);
      setSelectedDocId(doc.id);
      void qc.invalidateQueries({ queryKey: ["documents", projectId] });
    },
    onError: (err) => {
      setEpubUploadError(err instanceof Error ? err.message : "EPUB upload failed");
    },
  });

  const createPdfDocument = useMutation({
    mutationFn: async (file: File) => {
      const [upload, title] = await Promise.all([
        uploadFileWithMeta(file),
        resolvePdfDocumentTitle(file),
      ]);
      const res = await apiJson<{ data: ProjectDocument }>(`/api/v1/projects/${projectId}/documents`, {
        method: "POST",
        body: JSON.stringify({ title, kind: "pdf", uploadId: upload.id }),
      });
      return res.data;
    },
    onSuccess: (doc) => {
      setPdfUploadError(null);
      setSelectedDocId(doc.id);
      void qc.invalidateQueries({ queryKey: ["documents", projectId] });
    },
    onError: (err) => {
      setPdfUploadError(err instanceof Error ? err.message : "PDF upload failed");
    },
  });

  const saveDocument = useMutation({
    mutationFn: async ({
      docId,
      title,
      body,
      uploadId,
    }: {
      docId: number;
      title: string;
      body?: string;
      uploadId?: number;
    }) => {
      const payload: Record<string, unknown> = { title };
      if (body !== undefined) payload.body = body;
      if (uploadId !== undefined) payload.uploadId = uploadId;
      const res = await apiJson<{ data: ProjectDocument }>(
        `/api/v1/projects/${projectId}/documents/${docId}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      );
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
      {tab === "images" ? (
        <ImageBoardList projectId={project.id} heading="Images" />
      ) : null}

      {tab === "overview" ? (
        <div className="grid" style={{ gap: "1rem" }}>
          <div className="card">
            <div className="wiki-panel__main-head wiki-panel__main-head--actions-only">
              <div className="wiki-panel__main-actions">
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
                    onClick={beginOverviewEdit}
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
                    {PROJECT_STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field field--tags-below">
                  <TagInput entityType="project" entityId={projectId} />
                </div>
                <div className="field">
                  <label>Description</label>
                  <MarkdownEditor value={description} onChange={setDescription} autoHeight />
                </div>
              </>
            ) : (
              <>
                <p className="muted" style={{ marginTop: "-0.15rem", marginBottom: "0.75rem" }}>
                  {projectStatusLabel(project.status)}
                </p>
                <div className="field field--tags-below">
                  <TagInput entityType="project" entityId={projectId} readOnly />
                </div>
                <MarkdownEditor
                  value={project.description ?? ""}
                  onChange={() => undefined}
                  autoHeight
                  readOnly
                />
              </>
            )}
            {saveMeta.isError ? <p role="alert">{(saveMeta.error as Error).message}</p> : null}
          </div>
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
        <div style={{ marginTop: "1rem" }}>
          <PhaseManager projectId={projectId} phases={phasesQuery.data ?? []} />
        </div>
        <div className="card" style={{ marginTop: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Danger zone</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Deleting this project permanently removes its tasks, documents, groups, phases, and other project
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
                  onChange={(e) => setNewTaskTitle(sanitizePlainText(e.target.value))}
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
            key={navGroup ? `group-${navGroup.id}` : "list"}
            projectId={projectId}
            filter={displayedTaskListFilter}
            onApply={(next) => takeOverListFilter(next)}
            onClear={() => takeOverListFilter("clear")}
          />
          <div style={{ marginTop: "0.5rem" }}>
            <TaskBoard
              key={navListView ? `nav-list-${groupParam}` : "grouped-board"}
              projectId={projectId}
              groups={groups}
              tasks={tasks}
              listFilter={displayedTaskListFilter}
              navListView={navListView}
              requestOpenTask={requestOpenTask}
              onRequestOpenTaskConsumed={() => setRequestOpenTask(null)}
              onReorder={async (payload) => {
                await reorderTasks.mutateAsync(payload);
              }}
              onReorderGroups={async (orderedGroupIds) => {
                await apiJson(`/api/v1/projects/${projectId}/groups/reorder`, {
                  method: "PATCH",
                  body: JSON.stringify({ orderedGroupIds }),
                });
                void qc.invalidateQueries({ queryKey: ["task-groups", projectId] });
              }}
              onPatchGroup={async (groupId, patch) => {
                await apiJson(`/api/v1/projects/${projectId}/groups/${groupId}`, {
                  method: "PATCH",
                  body: JSON.stringify(patch),
                });
                await qc.invalidateQueries({ queryKey: ["task-groups", projectId] });
                void qc.invalidateQueries({ queryKey: ["taggings", "task"] });
                void qc.invalidateQueries({ queryKey: ["tags"] });
              }}
              onAttachTaskTag={async (taskId, tagId) => {
                await apiJson("/api/v1/taggings", {
                  method: "POST",
                  body: JSON.stringify({ entityType: "task", entityId: taskId, tagId }),
                });
                await qc.invalidateQueries({ queryKey: ["taggings", "task"] });
                void qc.invalidateQueries({ queryKey: ["tags"] });
              }}
              onAddGroupMember={async (groupId, taskId) => {
                await apiJson(`/api/v1/projects/${projectId}/groups/${groupId}/members`, {
                  method: "POST",
                  body: JSON.stringify({ taskId }),
                });
                await qc.invalidateQueries({ queryKey: ["task-groups", projectId] });
              }}
              onRemoveGroupMember={async (groupId, taskId) => {
                await apiJson(`/api/v1/projects/${projectId}/groups/${groupId}/members/${taskId}`, {
                  method: "DELETE",
                });
                await qc.invalidateQueries({ queryKey: ["task-groups", projectId] });
              }}
              onCreateGroup={async (name, filter) => {
                const res = await apiJson<{ data: TaskGroup }>(
                  `/api/v1/projects/${projectId}/groups`,
                  {
                    method: "POST",
                    body: JSON.stringify({ name, filter: filter ?? null }),
                  },
                );
                await qc.invalidateQueries({ queryKey: ["task-groups", projectId] });
                return res.data;
              }}
              onDeleteGroup={async (groupId) => {
                await apiJson(`/api/v1/projects/${projectId}/groups/${groupId}`, {
                  method: "DELETE",
                });
                void qc.invalidateQueries({ queryKey: ["task-groups", projectId] });
              }}
              onPatchTask={async (taskId, patch, opts) => {
                return patchTask.mutateAsync({
                  taskId,
                  body: patch,
                  deferHistory: opts?.deferHistory,
                });
              }}
            />
          </div>
          {reorderTasks.isError ? <p role="alert">{(reorderTasks.error as Error).message}</p> : null}
        </div>
      ) : null}

      {tab === "todo_lists" ? (
        <div>
          <TodoListTabBar
            lists={projectTodoLists}
            activeId={projectListId ?? projectTodoLists[0]?.id ?? null}
            itemCounts={todoListItemCounts}
            creating={createTodoList.isPending}
            onSelect={setProjectListId}
            onCreate={(title) => createTodoList.mutate(title)}
            onRename={(id, title) => renameTodoList.mutate({ id, title })}
            onRequestDelete={setPendingDeleteTodoList}
          />
          {(projectListId ?? projectTodoLists[0]?.id) != null ? (
            <TodoListView
              listId={(projectListId ?? projectTodoLists[0]!.id)!}
              defaultProjectId={projectId}
            />
          ) : (
            <p className="muted">Click +New to create a To Do list for this project.</p>
          )}
        </div>
      ) : null}

      {tab === "documents" ? (
        <div className="split-panel">
          <div className="documents-panel__sidebar">
            <div className="card documents-panel__create">
              <div className="documents-panel__create-row">
                <span className="documents-panel__create-label">New:</span>
                <div className="documents-panel__create-actions">
                  <button
                    type="button"
                    className="btn small btn-icon documents-panel__create-icon-btn"
                    disabled={
                      createDocument.isPending ||
                      createEpubDocument.isPending ||
                      createPdfDocument.isPending
                    }
                    aria-label={createDocument.isPending ? "Creating Markdown document" : "New Markdown document"}
                    title="New Markdown"
                    onClick={() => createDocument.mutate()}
                  >
                    <DocumentKindIcon kind="markdown" size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn small btn-icon documents-panel__create-icon-btn"
                    disabled={
                      createDocument.isPending ||
                      createEpubDocument.isPending ||
                      createPdfDocument.isPending
                    }
                    aria-label={
                      createEpubDocument.isPending ? "Uploading EPUB" : "Upload EPUB document"
                    }
                    title="Upload EPUB"
                    onClick={() => {
                      setEpubUploadError(null);
                      epubFileInputRef.current?.click();
                    }}
                  >
                    <DocumentKindIcon kind="epub" size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn small btn-icon documents-panel__create-icon-btn"
                    disabled={
                      createDocument.isPending ||
                      createEpubDocument.isPending ||
                      createPdfDocument.isPending
                    }
                    aria-label={createPdfDocument.isPending ? "Uploading PDF" : "Upload PDF document"}
                    title="Upload PDF"
                    onClick={() => {
                      setPdfUploadError(null);
                      pdfFileInputRef.current?.click();
                    }}
                  >
                    <DocumentKindIcon kind="pdf" size={16} />
                  </button>
                  <input
                    ref={epubFileInputRef}
                    type="file"
                    accept=".epub,application/epub+zip"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) createEpubDocument.mutate(file);
                    }}
                  />
                  <input
                    ref={pdfFileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) createPdfDocument.mutate(file);
                    }}
                  />
                </div>
              </div>
              {epubUploadError ? (
                <p className="muted small" role="alert" style={{ margin: "0.4rem 0 0" }}>
                  {epubUploadError}
                </p>
              ) : null}
              {pdfUploadError ? (
                <p className="muted small" role="alert" style={{ margin: "0.4rem 0 0" }}>
                  {pdfUploadError}
                </p>
              ) : null}
            </div>
            <div className="card documents-panel__toc">
              {documentsQuery.isLoading ? (
                <p className="muted">Loading…</p>
              ) : (
                <DocumentsToc
                  documents={documents}
                  selectedId={selectedDocId}
                  onSelect={setSelectedDocId}
                />
              )}
            </div>
          </div>
          <div className="card">
            {selectedDoc ? (
              <DocumentEditor
                key={selectedDoc.id}
                doc={selectedDoc}
                onSaveMarkdown={(title, body) =>
                  saveDocument.mutate({ docId: selectedDoc.id, title, body })
                }
                onSaveEpub={(title, uploadId) =>
                  saveDocument.mutate({ docId: selectedDoc.id, title, uploadId })
                }
                onSavePdf={(title, uploadId) =>
                  saveDocument.mutate({ docId: selectedDoc.id, title, uploadId })
                }
                onDelete={() => setPendingDocDelete(selectedDoc.id)}
                busy={saveDocument.isPending}
              />
            ) : (
              <p className="muted">Select or create a document.</p>
            )}
          </div>
        </div>
      ) : null}

      {tab === "boards" ? (
        <KanbanBoardsPanel
          projectId={projectId}
          initialBoardId={initialBoardId}
          onInitialBoardConsumed={() => clearSearchParam("board")}
        />
      ) : null}

      {tab === "wiki" ? (
        <WikiPanel
          projectId={projectId}
          initialNodeId={initialNodeId}
          onInitialNodeConsumed={() => clearSearchParam("node")}
        />
      ) : null}

      {tab === "canvases" ? (
        <CanvasesPanel
          projectId={projectId}
          initialCanvasId={initialCanvasId}
          onInitialCanvasConsumed={() => clearSearchParam("canvas")}
        />
      ) : null}

      <ConfirmDialog
        open={deleteProjectOpen}
        title="Delete project?"
        message="This removes tasks, documents, and groups for this project."
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

      <ConfirmDialog
        open={pendingDeleteTodoList != null}
        title="Delete list?"
        message={`Delete “${pendingDeleteTodoList?.title}”? Items are not deleted — only list membership.`}
        confirmLabel="Delete"
        onCancel={() => setPendingDeleteTodoList(null)}
        onConfirm={() => {
          if (pendingDeleteTodoList) deleteTodoList.mutate(pendingDeleteTodoList.id);
        }}
      />
    </div>
  );
}

function DocumentEditor({
  doc,
  onSaveMarkdown,
  onSaveEpub,
  onSavePdf,
  onDelete,
  busy,
}: {
  doc: ProjectDocument;
  onSaveMarkdown: (title: string, body: string) => void;
  onSaveEpub: (title: string, uploadId?: number) => void;
  onSavePdf: (title: string, uploadId?: number) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const kind = doc.kind ?? "markdown";
  const sanitizedTitle = sanitizePlainText(doc.title);
  const [title, setTitle] = useState(sanitizedTitle);
  const [body, setBody] = useState(doc.body ?? "");
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(sanitizedTitle);
  const [prevDocTitle, setPrevDocTitle] = useState(doc.title);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const skipTitleCommitRef = useRef(false);

  if (doc.title !== prevDocTitle) {
    setPrevDocTitle(doc.title);
    setTitle(sanitizedTitle);
    if (!editingTitle) setTitleDraft(sanitizedTitle);
  }

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  useRegisterAssistantAttach(
    useMemo(
      () => ({
        key: `document-${doc.id}`,
        label: title.trim() || `Document #${doc.id}`,
        getContext: () =>
          kind === "epub" || kind === "pdf"
            ? `Document #${doc.id} (project #${doc.projectId}, ${kind.toUpperCase()})\nTitle: ${title}\nFile: ${doc.fileOriginalName ?? doc.fileUrl ?? "(none)"}`
            : `Document #${doc.id} (project #${doc.projectId})\nTitle: ${title}\n\n${body}`,
      }),
      [doc.id, doc.projectId, doc.fileOriginalName, doc.fileUrl, title, body, kind],
    ),
  );

  const onSaveBinary = kind === "pdf" ? onSavePdf : onSaveEpub;
  const binaryExt = kind === "pdf" ? ".pdf" : ".epub";
  const binaryLabel = kind === "pdf" ? "PDF" : "EPUB";
  const binaryAccept =
    kind === "pdf" ? ".pdf,application/pdf" : ".epub,application/epub+zip";

  const commitBinaryTitle = () => {
    if (skipTitleCommitRef.current) {
      skipTitleCommitRef.current = false;
      return;
    }
    const next = sanitizePlainText(titleDraft).trim() || title;
    setTitleDraft(next);
    setEditingTitle(false);
    if (next !== title) {
      setTitle(next);
      onSaveBinary(next);
    }
  };

  const cancelBinaryTitleEdit = () => {
    skipTitleCommitRef.current = true;
    setTitleDraft(title);
    setEditingTitle(false);
  };

  if (kind === "epub" || kind === "pdf") {
    const headingTitle =
      title.replace(new RegExp(`\\${binaryExt}$`, "i"), "").trim() || title;
    return (
      <div className={`document-editor document-editor--${kind}`}>
        <div className="page-head document-editor__head">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="document-editor__title-input"
              aria-label="Document title"
              value={titleDraft}
              disabled={busy}
              onChange={(e) => setTitleDraft(sanitizePlainText(e.target.value))}
              onBlur={() => commitBinaryTitle()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelBinaryTitleEdit();
                }
              }}
            />
          ) : (
            <h2
              className="document-editor__title"
              title="Double-click to rename"
              onDoubleClick={() => {
                setTitleDraft(headingTitle);
                setEditingTitle(true);
              }}
            >
              <span className="muted">{formatEntityRef("document", doc.number)} </span>
              {headingTitle}
            </h2>
          )}
          <div className="document-editor__head-actions">
            <button
              type="button"
              className="btn small"
              disabled={busy || replacing}
              onClick={() => {
                setReplaceError(null);
                replaceInputRef.current?.click();
              }}
            >
              {replacing ? "Replacing…" : `Replace ${binaryLabel}`}
            </button>
            <button type="button" className="btn danger small" onClick={onDelete}>
              Delete
            </button>
            <input
              ref={replaceInputRef}
              type="file"
              accept={binaryAccept}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setReplacing(true);
                setReplaceError(null);
                void (async () => {
                  try {
                    const [upload, metaTitle] = await Promise.all([
                      uploadFileWithMeta(file),
                      kind === "pdf"
                        ? resolvePdfDocumentTitle(file)
                        : resolveEpubDocumentTitle(file),
                    ]);
                    setTitle(metaTitle);
                    setTitleDraft(metaTitle);
                    onSaveBinary(metaTitle, upload.id);
                  } catch (err) {
                    setReplaceError(err instanceof Error ? err.message : "Replace failed");
                  } finally {
                    setReplacing(false);
                  }
                })();
              }}
            />
          </div>
        </div>
        {replaceError ? (
          <p className="muted small" role="alert">
            {replaceError}
          </p>
        ) : null}
        {doc.fileUrl ? (
          kind === "pdf" ? (
            <PdfReader key={doc.fileUrl} fileUrl={doc.fileUrl} />
          ) : (
            <EpubReader key={doc.fileUrl} fileUrl={doc.fileUrl} />
          )
        ) : (
          <p className="muted">{binaryLabel} file missing.</p>
        )}
        <div className="field field--tags-below">
          <TagInput entityType="document" entityId={doc.id} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <h2 style={{ margin: 0 }}>
          <span className="muted">{formatEntityRef("document", doc.number)} </span>
          Edit document
        </h2>
        <button type="button" className="btn danger small" onClick={onDelete}>
          Delete
        </button>
      </div>
      <div className="field">
        <label htmlFor="doc-title">Title</label>
        <input id="doc-title" type="text" value={title} onChange={(e) => setTitle(sanitizePlainText(e.target.value))} />
      </div>
      <div className="field">
        <label>Body</label>
        <MarkdownEditor value={body} onChange={setBody} autoHeight />
      </div>
      <button
        type="button"
        className="btn primary"
        disabled={busy}
        onClick={() => onSaveMarkdown(title, body)}
      >
        Save document
      </button>
      <div className="field field--tags-below">
        <TagInput entityType="document" entityId={doc.id} />
      </div>
    </div>
  );
}
