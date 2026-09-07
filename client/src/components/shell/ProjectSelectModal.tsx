import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { apiJson } from "../../api/client";
import type { Project } from "../../types";
import { NavIcon } from "./NavIcon";
import { shellIcons } from "./shellIcons";

type Props = {
  open: boolean;
  activeProjectId: number | null;
  onClose: () => void;
  onNavigate?: () => void;
};

export function ProjectSelectModal({ open, activeProjectId, onClose, onNavigate }: Props) {
  const titleId = useId();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [query, setQuery] = useState("");
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setQuery("");
  }
  const onAllProjects = pathname === "/projects";

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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

  const go = (path: string) => {
    navigate(path);
    onClose();
    onNavigate?.();
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal project-select-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Projects</h2>
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
              className={`task-picker-list__btn${onAllProjects ? " is-selected" : ""}`}
              onClick={() => go("/projects")}
            >
              All projects
            </button>
          </li>
          {projectsQuery.isLoading ? (
            <li className="muted task-picker-list__hint">Loading…</li>
          ) : null}
          {projectsQuery.isSuccess && filtered.length === 0 ? (
            <li className="muted task-picker-list__hint">
              {query.trim() ? "No matches" : "No projects yet"}
            </li>
          ) : null}
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={`task-picker-list__btn${activeProjectId === p.id ? " is-selected" : ""}`}
                onClick={() => go(`/projects/${p.id}`)}
              >
                <span className="muted">P{String(p.number).padStart(4, "0")}</span> {p.name}
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="task-picker-list__btn" onClick={() => go("/projects/new")}>
              <NavIcon icon={shellIcons.add} className="app-nav__inline-icon" />
              New project
            </button>
          </li>
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
