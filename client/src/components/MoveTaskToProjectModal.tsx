import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../api/client";
import type { Project } from "../types";

type Props = {
  open: boolean;
  currentProjectId: number | null;
  onClose: () => void;
  onSave: (projectId: number | null) => Promise<void>;
};

export function MoveTaskToProjectModal({ open, currentProjectId, onClose, onSave }: Props) {
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(currentProjectId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    enabled: open,
    queryFn: async () => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects");
      return res.data;
    },
  });

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedId(currentProjectId);
    setError(null);
    setBusy(false);
  }, [open, currentProjectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const filtered = useMemo(() => {
    const list = projectsQuery.data ?? [];
    const q = query.trim().toLocaleLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLocaleLowerCase().includes(q) ||
        String(p.number).includes(q) ||
        `p${String(p.number).padStart(4, "0")}`.includes(q),
    );
  }, [projectsQuery.data, query]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Move to project</h2>
        <label className="stack-field">
          <span className="muted">Search projects</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or P####"
            autoFocus
          />
        </label>
        <ul className="task-picker-list" role="listbox" aria-label="Projects">
          <li>
            <button
              type="button"
              className={`task-picker-list__btn${selectedId == null ? " is-selected" : ""}`}
              onClick={() => setSelectedId(null)}
            >
              <span className="muted">Unassigned</span>
            </button>
          </li>
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={`task-picker-list__btn${selectedId === p.id ? " is-selected" : ""}`}
                onClick={() => setSelectedId(p.id)}
              >
                <span className="muted">P{String(p.number).padStart(4, "0")}</span> {p.name}
              </button>
            </li>
          ))}
        </ul>
        {error ? (
          <p className="confirm-dialog__warning" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || selectedId === currentProjectId}
            onClick={() => {
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  await onSave(selectedId);
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
