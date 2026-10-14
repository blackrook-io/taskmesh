import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "../../api/client";
import { useAuth } from "../../lib/auth";
import { userIsAdministrator } from "../../lib/roles";
import {
  compareTaskHistoryEntries,
  loadTaskHistoryShowChanges,
  loadTaskHistorySortDir,
  saveTaskHistoryShowChanges,
  saveTaskHistorySortDir,
  type TaskHistorySortDir,
} from "../../lib/taskHistorySort";
import type { TaskActivityEntry } from "../../types";
import { ConfirmDialog } from "../ConfirmDialog";
import { MarkdownEditor } from "./MarkdownEditor";

type HistoryEntityType = "task" | "todo" | "todo_list";

function activityPath(entityType: HistoryEntityType, entityId: number): string {
  if (entityType === "task") return `/api/v1/tasks/${entityId}/activity`;
  if (entityType === "todo") return `/api/v1/todos/${entityId}/activity`;
  return `/api/v1/todo-lists/${entityId}/activity`;
}

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  state: "State",
  priority: "Priority",
  dueDate: "Due date",
  startDate: "Start date",
  estimateHours: "Hours",
  color: "Color",
  phaseId: "Phase",
  parentId: "Parent",
  projectId: "Project",
  dependsOn: "Depends on",
  requiredBy: "Required by",
  summary: "Updated",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local `MM/DD HH:MM - Username` (or without name when unknown). */
function formatHistoryMeta(ts: string, displayName: string | null | undefined): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    return displayName ? `${ts} - ${displayName}` : ts;
  }
  const stamp = `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return displayName ? `${stamp} - ${displayName}` : stamp;
}

function changeSummaryText(entry: TaskActivityEntry): string {
  if (entry.field === "summary" && entry.body) {
    return entry.body;
  }
  if (entry.field === "description") {
    return "Description updated.";
  }
  const label = FIELD_LABELS[entry.field ?? ""] ?? entry.field ?? "Field";
  return `${label} changed from ${entry.oldValue ?? "none"} to ${entry.newValue ?? "none"}`;
}

function HistoryMeta({ entry }: { entry: TaskActivityEntry }) {
  const name = entry.createdBy?.displayName ?? null;
  return (
    <span className="muted task-history__change-ts">
      {formatHistoryMeta(entry.createdAt, name)}
      {entry.source === "api" ? (
        <span className="task-history__api-flag" title="Changed via API">
          API
        </span>
      ) : null}
      {entry.source === "ai" ? (
        <span className="task-history__api-flag" title="Changed by the assistant">
          AI
        </span>
      ) : null}
    </span>
  );
}

export function TaskHistory({ taskId }: { taskId: number }) {
  return <RecordHistory entityType="task" entityId={taskId} />;
}

export function RecordHistory({
  entityType,
  entityId,
}: {
  entityType: HistoryEntityType;
  entityId: number;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = userIsAdministrator(user);
  const path = activityPath(entityType, entityId);
  const key =
    entityType === "task"
      ? (["task-activity", entityId] as const)
      : (["entity-activity", entityType, entityId] as const);
  const [draft, setDraft] = useState("");
  const [composerKey, setComposerKey] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<TaskHistorySortDir>(() => loadTaskHistorySortDir());
  const [showChanges, setShowChanges] = useState(() => loadTaskHistoryShowChanges());

  const activityQuery = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await apiJson<{ data: TaskActivityEntry[] }>(path);
      return res.data;
    },
  });

  const add = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiJson<{ data: TaskActivityEntry }>(path, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      return res.data;
    },
    onSuccess: () => {
      setDraft("");
      setComposerKey((k) => k + 1);
      setError(null);
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["graph"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const edit = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: string }) => {
      const res = await apiJson<{ data: TaskActivityEntry }>(`${path}/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      });
      return res.data;
    },
    onSuccess: () => {
      setEditingId(null);
      setEditDraft("");
      setError(null);
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["graph"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`${path}/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      setPendingDeleteId(null);
      setEditingId(null);
      setError(null);
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["graph"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const entries = useMemo(() => {
    const list = [...(activityQuery.data ?? [])].filter(
      (entry) => showChanges || entry.kind === "comment",
    );
    list.sort((a, b) => compareTaskHistoryEntries(a, b, sortDir));
    return list;
  }, [activityQuery.data, sortDir, showChanges]);

  const toggleSortDir = () => {
    setSortDir((prev) => {
      const next: TaskHistorySortDir = prev === "asc" ? "desc" : "asc";
      saveTaskHistorySortDir(next);
      return next;
    });
  };

  const onShowChangesChange = (checked: boolean) => {
    setShowChanges(checked);
    saveTaskHistoryShowChanges(checked);
  };

  return (
    <div className="task-history">
      <div className="task-history__header">
        <label className="task-history__title">
          <input
            type="checkbox"
            className="task-history__show-changes"
            checked={showChanges}
            onChange={(e) => onShowChangesChange(e.target.checked)}
            aria-label="Show history change entries"
            title="Show field-change history (comments always stay visible)"
          />
          <span className="task-history__label">History</span>
        </label>
        <button
          type="button"
          className="btn small ghost task-history__sort-toggle"
          onClick={toggleSortDir}
          title={
            sortDir === "asc"
              ? "Showing oldest first — click for newest first"
              : "Showing newest first — click for oldest first"
          }
          aria-label={
            sortDir === "asc"
              ? "History sort: oldest first. Switch to newest first"
              : "History sort: newest first. Switch to oldest first"
          }
        >
          {sortDir === "asc" ? "↑ Oldest first" : "↓ Newest first"}
        </button>
      </div>
      <div className="task-history__list">
        {entries.length === 0 ? (
          <p className="muted task-history__empty">
            {showChanges ? "No history yet." : "No comments yet."}
          </p>
        ) : (
          entries.map((entry) =>
            entry.kind === "comment" ? (
              <div key={entry.id} className="task-history__comment">
                <div className="task-history__meta">
                  <HistoryMeta entry={entry} />
                  {editingId === entry.id ? null : (
                    <span className="task-history__meta-actions">
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={() => {
                          setEditingId(entry.id);
                          setEditDraft(entry.body ?? "");
                        }}
                      >
                        Edit
                      </button>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() => setPendingDeleteId(entry.id)}
                        >
                          Delete
                        </button>
                      ) : null}
                    </span>
                  )}
                </div>
                {editingId === entry.id ? (
                  <>
                    <MarkdownEditor
                      value={editDraft}
                      onChange={setEditDraft}
                      height={140}
                      placeholder="Edit comment…"
                    />
                    <div className="task-history__actions">
                      <button
                        type="button"
                        className="btn small"
                        disabled={!editDraft.trim() || edit.isPending}
                        onClick={() => edit.mutate({ id: entry.id, body: editDraft })}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <MarkdownEditor
                      value={entry.body ?? ""}
                      onChange={() => {}}
                      height={60}
                      readOnly
                    />
                    {entry.editedAt ? (
                      <span className="task-history__edited muted">
                        Edited: {formatHistoryMeta(entry.editedAt, entry.createdBy?.displayName)}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <div key={entry.id} className="task-history__change">
                <span className="task-history__change-text">{changeSummaryText(entry)}</span>
                <HistoryMeta entry={entry} />
              </div>
            ),
          )
        )}
      </div>
      <div className="task-history__composer">
        <MarkdownEditor
          key={composerKey}
          value={draft}
          onChange={setDraft}
          height={140}
          placeholder="Add a comment…"
        />
        <div className="task-history__actions">
          <button
            type="button"
            className="btn small"
            disabled={!draft.trim() || add.isPending}
            onClick={() => add.mutate(draft)}
          >
            Add entry
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="tag-input__error">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={pendingDeleteId != null}
        title="Delete comment?"
        message="This comment will be removed. This cannot be undone."
        confirmLabel="Delete"
        confirmDisabled={remove.isPending}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId != null) remove.mutate(pendingDeleteId);
        }}
      />
    </div>
  );
}
