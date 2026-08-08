import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { apiJson } from "../../api/client";
import { APP_VERSION } from "../../lib/appVersion";
import { useSettings } from "../../lib/settings";
import { useActiveProjectId, useShellSection } from "../../lib/useShellNav";
import type { Project } from "../../types";
import { BrandWordmark } from "./BrandWordmark";
import { MeshMark } from "./MeshMark";
import { NavIcon } from "./NavIcon";
import { shellIcons } from "./shellIcons";
import { SystemClock } from "./SystemClock";

type Props = {
  onOpenPalette: () => void;
  onOpenAssistant: () => void;
  onNavigate?: () => void;
};

export function AppNav({ onOpenPalette, onOpenAssistant, onNavigate }: Props) {
  const section = useShellSection();
  const activeProjectId = useActiveProjectId();
  const { open: settingsOpen, openSettings } = useSettings();
  const [projectsOpen, setProjectsOpen] = useState(section === "projects");

  useEffect(() => {
    if (section === "projects") setProjectsOpen(true);
  }, [section]);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects");
      return res.data;
    },
    enabled: projectsOpen,
  });

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    `app-nav__item${isActive ? " is-active" : ""}`;

  return (
    <aside className="app-nav" aria-label="App">
      <div className="app-nav__top">
        <BrandWordmark />
      </div>

      <nav className="app-nav__sections">
        <div className="app-nav__section">
          <button
            type="button"
            className={`app-nav__item app-nav__item--toggle${section === "projects" ? " is-active" : ""}`}
            aria-expanded={projectsOpen}
            onClick={() => setProjectsOpen((o) => !o)}
          >
            <span className="app-nav__glyph" aria-hidden>
              <NavIcon icon={shellIcons.projects} />
            </span>
            <span className="app-nav__label">Projects</span>
            <span className="app-nav__chevron" aria-hidden>
              {projectsOpen ? "▾" : "▸"}
            </span>
          </button>
          {projectsOpen ? (
            <ul className="app-nav__projects">
              <li>
                <NavLink
                  to="/projects"
                  end
                  className={({ isActive }) =>
                    `app-nav__project${isActive && activeProjectId == null ? " is-active" : ""}`
                  }
                  onClick={onNavigate}
                >
                  All projects
                </NavLink>
              </li>
              {(projectsQuery.data ?? []).map((p) => (
                <li key={p.id}>
                  <NavLink
                    to={`/projects/${p.id}`}
                    className={({ isActive }) => `app-nav__project${isActive ? " is-active" : ""}`}
                    onClick={onNavigate}
                  >
                    <span className="app-nav__dot" aria-hidden />
                    <span className="app-nav__project-name">{p.name}</span>
                  </NavLink>
                </li>
              ))}
              {projectsQuery.isLoading ? (
                <li className="app-nav__hint muted">Loading…</li>
              ) : null}
              {projectsQuery.isSuccess && (projectsQuery.data?.length ?? 0) === 0 ? (
                <li className="app-nav__hint muted">No projects yet</li>
              ) : null}
              <li>
                <Link to="/projects/new" className="app-nav__project" onClick={onNavigate}>
                  <NavIcon icon={shellIcons.add} className="app-nav__inline-icon" />
                  New project
                </Link>
              </li>
            </ul>
          ) : null}
        </div>

        <NavLink to="/ideas" className={itemClass} onClick={onNavigate}>
          <span className="app-nav__glyph" aria-hidden>
            <NavIcon icon={shellIcons.ideas} />
          </span>
          <span className="app-nav__label">Ideas</span>
        </NavLink>
        <NavLink to="/tasks" className={itemClass} onClick={onNavigate}>
          <span className="app-nav__glyph" aria-hidden>
            <NavIcon icon={shellIcons.tasks} />
          </span>
          <span className="app-nav__label">Tasks</span>
        </NavLink>
        <NavLink to="/filesystem" className={itemClass} onClick={onNavigate}>
          <span className="app-nav__glyph" aria-hidden>
            <NavIcon icon={shellIcons.filesystem} />
          </span>
          <span className="app-nav__label">Filesystem</span>
        </NavLink>
        <NavLink to="/image-board" className={itemClass} onClick={onNavigate}>
          <span className="app-nav__glyph" aria-hidden>
            <NavIcon icon={shellIcons.imageBoard} />
          </span>
          <span className="app-nav__label">Image board</span>
        </NavLink>
        <NavLink to="/todos" className={itemClass} onClick={onNavigate}>
          <span className="app-nav__glyph" aria-hidden>
            <NavIcon icon={shellIcons.lists} />
          </span>
          <span className="app-nav__label">Lists</span>
        </NavLink>
        <NavLink to="/calendar" className={itemClass} onClick={onNavigate}>
          <span className="app-nav__glyph" aria-hidden>
            <NavIcon icon={shellIcons.calendar} />
          </span>
          <span className="app-nav__label">Calendar</span>
        </NavLink>
      </nav>

      <div className="app-nav__footer">
        <div className="app-nav__tools">
          <button
            type="button"
            className="btn ghost small"
            onClick={onOpenAssistant}
            title="Assistant (Ctrl/⌘J)"
            aria-keyshortcuts="Control+J Meta+J"
          >
            <NavIcon icon={shellIcons.assistant} className="app-nav__inline-icon" />
            AI
          </button>
          <button
            type="button"
            className="btn ghost small command-palette-trigger"
            onClick={onOpenPalette}
            title="Command palette (Ctrl/⌘K)"
            aria-keyshortcuts="Control+K Meta+K"
          >
            <NavIcon icon={shellIcons.search} className="app-nav__inline-icon" />
            ⌘K
          </button>
        </div>
        <button
          type="button"
          className={`app-nav__item${settingsOpen ? " is-active" : ""}`}
          onClick={() => {
            openSettings("appearance");
            onNavigate?.();
          }}
        >
          <span className="app-nav__glyph" aria-hidden>
            <NavIcon icon={shellIcons.settings} />
          </span>
          <span className="app-nav__label">Settings</span>
        </button>
        <div className="app-nav__brand-foot">
          <MeshMark className="app-nav__mesh-mark" />
          <span className="app-nav__version" title={`TaskMesh ${APP_VERSION}`}>
            v{APP_VERSION}
          </span>
        </div>
        <SystemClock />
      </div>
    </aside>
  );
}
