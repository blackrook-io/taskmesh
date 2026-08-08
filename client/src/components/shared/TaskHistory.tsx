import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "../../api/client";
import type { TaskActivityEntry } from "../../types";
import { MarkdownEditor } from "./MarkdownEditor";

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  state: "State",
  priority: "Priority",
  dueDate: "Due date",
  color: "Color",
  phaseId: "Phase",
  parentId: "Parent",
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export function TaskHistory({ taskId }: { taskId: number }) {
  const qc = useQueryClient();
  const key = ["task-activity", taskId] as const;
  const [draft, setDraft] = useState("");
  const [composerKey, setComposerKey] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activityQuery = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await apiJson<{ data: TaskActivityEntry[] }>(
        `/api/v1/tasks/${taskId}/activity`,
      );
      return res.data;
    },
  });

  const add = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiJson<{ data: TaskActivityEntry }>(
        `/api/v1/tasks/${taskId}/activity`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
      return res.data;
    },
    onSuccess: () => {
      setDraft("");
      setComposerKey((k) => k + 1);
      setError(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err: Error) => setError(err.message),
  });

  const edit = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: string }) => {
      const res = await apiJson<{ data: TaskActivityEntry }>(
        `/api/v1/tasks/${taskId}/activity/${id}`,
        { method: "PATCH", body: JSON.stringify({ body }) },
      );
      return res.data;
    },
    onSuccess: () => {
      setEditingId(null);
      setEditDraft("");
      setError(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err: Error) => setError(err.message),
  });

  const entries = activityQuery.data ?? [];

  return (
    <div className="task-history">
      <label className="task-history__label">History</label>
      <div className="task-history__list">
        {entries.length === 0 ? (
          <p className="muted task-history__empty">No history yet.</p>
        ) : (
          entries.map((entry) =>
            entry.kind === "comment" ? (
              <div key={entry.id} className="task-history__comment">
                <div className="task-history__meta">
                  <span className="muted">{formatTimestamp(entry.createdAt)}</span>
                  {editingId === entry.id ? null : (
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
                        Edited: {formatTimestamp(entry.editedAt)}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <div key={entry.id} className="task-history__change">
                <span className="task-history__change-text">
                  <strong>{FIELD_LABELS[entry.field ?? ""] ?? entry.field}</strong> changed
                  from <span className="task-history__val">{entry.oldValue ?? "none"}</span> to{" "}
                  <span className="task-history__val">{entry.newValue ?? "none"}</span>
                </span>
                <span className="muted task-history__change-ts">
                  {formatTimestamp(entry.createdAt)}
                </span>
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
    </div>
  );
}
