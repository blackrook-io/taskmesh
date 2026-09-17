import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../api/client";
import type { UserRef } from "../types";

type Props = {
  open: boolean;
  projectId: number | null;
  currentAssigneeId: number | null;
  currentAssignee: UserRef | null;
  onClose: () => void;
  onSave: (assigneeId: number | null) => Promise<void>;
};

type Draft =
  | { mode: "search"; query: string }
  | { mode: "picked"; user: UserRef }
  | { mode: "clear" };

function userLabel(u: UserRef): string {
  return u.displayName || u.referenceId;
}

export function AssignToUserModal({
  open,
  projectId,
  currentAssigneeId,
  currentAssignee,
  onClose,
  onSave,
}: Props) {
  const titleId = useId();
  const [draft, setDraft] = useState<Draft>({ mode: "search", query: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initKey = open ? `open:${projectId}:${currentAssigneeId}` : "closed";
  const [prevInitKey, setPrevInitKey] = useState(initKey);
  if (prevInitKey !== initKey) {
    setPrevInitKey(initKey);
    if (open) {
      setDraft({ mode: "search", query: "" });
      setError(null);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const usersQuery = useQuery({
    queryKey: ["assignable-users", projectId],
    enabled: open && projectId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: UserRef[] }>(
        `/api/v1/projects/${projectId}/assignable-users`,
      );
      return res.data;
    },
  });

  const query =
    draft.mode === "search" ? draft.query.trim().toLowerCase() : "";
  const filtered = useMemo(() => {
    const users = usersQuery.data ?? [];
    if (!query) return users;
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(query) ||
        u.referenceId.toLowerCase().includes(query),
    );
  }, [usersQuery.data, query]);

  if (!open) return null;

  const noProject = projectId == null;
  const nextAssigneeId =
    draft.mode === "picked"
      ? draft.user.id
      : draft.mode === "clear"
        ? null
        : undefined;
  const canSave =
    !noProject &&
    nextAssigneeId !== undefined &&
    nextAssigneeId !== currentAssigneeId &&
    !busy;

  const inputValue =
    draft.mode === "picked"
      ? userLabel(draft.user)
      : draft.mode === "clear"
        ? ""
        : draft.query;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Assign to…</h2>
        {noProject ? (
          <p className="muted">Link this task to a project before assigning.</p>
        ) : (
          <>
            {currentAssignee ? (
              <p className="muted" style={{ marginTop: 0 }}>
                Currently: <strong>{userLabel(currentAssignee)}</strong>
              </p>
            ) : (
              <p className="muted" style={{ marginTop: 0 }}>
                Currently unassigned
              </p>
            )}
            <label className="stack-field">
              <span className="muted">Search people</span>
              <input
                type="search"
                value={inputValue}
                onChange={(e) => setDraft({ mode: "search", query: e.target.value })}
                placeholder="Name or U####"
                autoFocus
                aria-autocomplete="list"
              />
            </label>
            {draft.mode === "picked" ? (
              <p className="task-picker-selected" role="status">
                Selected: <strong>{userLabel(draft.user)}</strong>
              </p>
            ) : draft.mode === "clear" ? (
              <p className="task-picker-selected muted" role="status">
                Assignee will be cleared on Save.
              </p>
            ) : null}
            <ul className="task-picker-list" role="listbox" aria-label="Assignable users">
              {draft.mode === "picked" || draft.mode === "clear" ? (
                <li className="muted task-picker-list__hint">
                  Edit the search field to choose someone else.
                </li>
              ) : usersQuery.isFetching ? (
                <li className="muted task-picker-list__hint">Loading…</li>
              ) : filtered.length === 0 ? (
                <li className="muted task-picker-list__hint">No matches</li>
              ) : (
                filtered.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="task-picker-list__btn"
                      role="option"
                      onClick={() => setDraft({ mode: "picked", user: u })}
                    >
                      {userLabel(u)}{" "}
                      <span className="muted">{u.referenceId}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </>
        )}
        {error ? (
          <p className="confirm-dialog__warning" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          {!noProject ? (
            <button
              type="button"
              className="btn ghost"
              disabled={busy || (currentAssigneeId == null && draft.mode !== "picked")}
              onClick={() => setDraft({ mode: "clear" })}
              title="Clear assignee on Save"
            >
              Clear assignee
            </button>
          ) : null}
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canSave}
            onClick={() => {
              if (nextAssigneeId === undefined) return;
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  await onSave(nextAssigneeId);
                  onClose();
                } catch (err) {
                  setError((err as Error).message);
                  setBusy(false);
                }
              })();
            }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
