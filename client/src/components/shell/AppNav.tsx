import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { apiJson } from "../../api/client";
import {
  bundledAppVersionMeta,
  formatVersionTooltip,
  type AppVersionMeta,
} from "../../lib/appVersion";
import { type AppNavMode } from "../../lib/appNavMode";
import { useAdministration } from "../../lib/administration";
import { useAuth } from "../../lib/auth";
import { userIsAdministrator } from "../../lib/roles";
import { useSettings } from "../../lib/settings";
import {
  useActiveProjectId,
  useActiveProjectNavItems,
  useShellSection,
  type ContextNavItem,
} from "../../lib/useShellNav";
import type { Project } from "../../types";
import { BrandWordmark } from "./BrandWordmark";
import { MeshMark } from "./MeshMark";
import { NavIcon } from "./NavIcon";
import { ProjectSelectModal } from "./ProjectSelectModal";
import { shellIcons } from "./shellIcons";
import { SystemClock } from "./SystemClock";

const EMPTY_PROJECTS: Project[] = [];

type Props = {
  mode: AppNavMode;
  onCollapse: () => void;
  onExpand: () => void;
  onOpenPalette: () => void;
  onOpenAssistant: () => void;
  onNavigate?: () => void;
};

function ProjectModuleLink({
  item,
  onNavigate,
  className,
}: {
  item: ContextNavItem;
  onNavigate?: () => void;
  className?: string;
}) {
  const nested = item.nested ? " app-nav__module--nested" : "";
  const active = item.active ? " is-active" : "";
  const glyph = item.swatch ? (
    <span className="app-nav__glyph" aria-hidden>
      <span className="app-nav__module-swatch" style={{ background: item.swatch }} />
    </span>
  ) : item.icon ? (
    <span className="app-nav__glyph" aria-hidden>
      <NavIcon icon={item.icon} />
    </span>
  ) : null;

  const content = (
    <>
      {glyph}
      <span className="app-nav__module-label">{item.label}</span>
    </>
  );

  if (item.disabled || !item.path) {
    return (
      <span className={`${className ?? "app-nav__module"} is-disabled${active}${nested}`} title={item.title}>
        {content}
      </span>
    );
  }

  return (
    <Link
      to={item.path}
      className={`${className ?? "app-nav__module"}${active}${nested}`}
      title={item.title ?? item.label}
      onClick={onNavigate}
    >
      {content}
    </Link>
  );
}

function SortableProjectNavItem({
  project,
  active,
  modules,
  onNavigate,
}: {
  project: Project;
  active: boolean;
  modules: ContextNavItem[];
  onNavigate?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const mainModules = modules.filter((item) => item.pin !== "bottom");
  const bottomModules = modules.filter((item) => item.pin === "bottom");

  return (
    <li ref={setNodeRef} style={style} className={isDragging ? "is-dragging" : undefined}>
      <NavLink
        to={`/projects/${project.id}`}
        className={() =>
          `app-nav__project${active ? " is-active" : ""}${isDragging ? " is-dragging" : ""}`
        }
        onClick={onNavigate}
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <span className="app-nav__dot" aria-hidden />
        <span className="app-nav__project-name">{project.name}</span>
      </NavLink>
      {active && modules.length > 0 ? (
        <ul className="app-nav__modules" aria-label={`${project.name} modules`}>
          {mainModules.map((item) => (
            <li key={item.id}>
              <ProjectModuleLink item={item} onNavigate={onNavigate} />
            </li>
          ))}
          {bottomModules.length > 0 ? (
            <>
              <li className="app-nav__modules-sep" aria-hidden />
              {bottomModules.map((item) => (
                <li key={item.id}>
                  <ProjectModuleLink item={item} onNavigate={onNavigate} />
                </li>
              ))}
            </>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

export function AppNav({
  mode,
  onCollapse,
  onExpand,
  onOpenPalette,
  onOpenAssistant,
  onNavigate,
}: Props) {
  const less = mode === "less";
  const section = useShellSection();
  const activeProjectId = useActiveProjectId();
  const { items: projectModules } = useActiveProjectNavItems();
  const { open: settingsOpen, openSettings } = useSettings();
  const { open: adminOpen, openAdmin } = useAdministration();
  const { user } = useAuth();
  const showAdmin = userIsAdministrator(user);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [prevSection, setPrevSection] = useState(section);
  if (prevSection !== section) {
    setPrevSection(section);
    if (section === "projects") setProjectsOpen(true);
  }
  const [projectSelectOpen, setProjectSelectOpen] = useState(false);
  const qc = useQueryClient();

  const healthQuery = useQuery({
    queryKey: ["api-health"],
    queryFn: async () =>
      apiJson<{
        ok?: boolean;
        meta?: Partial<AppVersionMeta>;
      }>("/api/health"),
    staleTime: 60_000,
  });

  const bundled = bundledAppVersionMeta();
  const apiMeta = healthQuery.data?.meta;
  const versionMeta: AppVersionMeta = {
    version: apiMeta?.version ?? bundled.version,
    createdAt: apiMeta?.createdAt !== undefined ? (apiMeta.createdAt ?? null) : bundled.createdAt,
    releasedAt: apiMeta?.releasedAt ?? null,
  };
  const versionTooltip = formatVersionTooltip(versionMeta);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects");
      return res.data;
    },
    enabled: projectsOpen && !less,
  });

  const projects = projectsQuery.data ?? EMPTY_PROJECTS;
  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  const reorderProjects = useMutation({
    mutationFn: async (orderedProjectIds: number[]) => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects/reorder", {
        method: "PATCH",
        body: JSON.stringify({ orderedProjectIds }),
      });
      return res.data;
    },
    onSuccess: (rows) => {
      qc.setQueryData(["projects"], rows);
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleProjectDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = projectIds.indexOf(Number(active.id));
    const newIndex = projectIds.indexOf(Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(projects, oldIndex, newIndex);
    qc.setQueryData(["projects"], next);
    void reorderProjects.mutateAsync(next.map((p) => p.id));
  };

  const lessModuleItems = projectModules.filter((item) => !item.nested && item.path);

  return (
    <aside className={`app-nav${less ? " app-nav--less" : ""}`} aria-label="App">
      <div className="app-nav__rail" role="group" aria-label="Navigation width">
        {mode === "less" ? (
          <button
            type="button"
            className="app-nav__rail-btn"
            onClick={onExpand}
            title="Expand navigation"
            aria-label="Expand navigation"
          >
            <span aria-hidden>›</span>
          </button>
        ) : null}
        {mode === "full" || mode === "less" ? (
          <button
            type="button"
            className="app-nav__rail-btn"
            onClick={onCollapse}
            title={mode === "full" ? "Show less navigation" : "Hide navigation"}
            aria-label={mode === "full" ? "Show less navigation" : "Hide navigation"}
          >
            <span aria-hidden>‹</span>
          </button>
        ) : null}
      </div>

      <div className="app-nav__top">
        {less ? (
          <Link to="/" className="app-nav__mark-link" title={versionTooltip} onClick={onNavigate}>
            <MeshMark className="app-nav__mark" title="" />
          </Link>
        ) : (
          <BrandWordmark title={versionTooltip} />
        )}
      </div>

      <nav className="app-nav__sections">
        {less ? (
          <>
            <button
              type="button"
              className={`app-nav__item${section === "projects" ? " is-active" : ""}`}
              title="Projects"
              aria-haspopup="dialog"
              aria-expanded={projectSelectOpen}
              onClick={() => setProjectSelectOpen(true)}
            >
              <span className="app-nav__glyph" aria-hidden>
                <NavIcon icon={shellIcons.projects} />
              </span>
              <span className="app-nav__label">Projects</span>
            </button>
            {lessModuleItems.map((item) => (
              <Link
                key={item.id}
                to={item.path!}
                className={`app-nav__item${item.active ? " is-active" : ""}`}
                title={item.label}
                onClick={onNavigate}
              >
                <span className="app-nav__glyph" aria-hidden>
                  {item.icon ? <NavIcon icon={item.icon} /> : null}
                </span>
                <span className="app-nav__label">{item.label}</span>
              </Link>
            ))}
          </>
        ) : (
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
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleProjectDragEnd}
              >
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
                  <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
                    {projects.map((p) => (
                      <SortableProjectNavItem
                        key={p.id}
                        project={p}
                        active={activeProjectId === p.id}
                        modules={activeProjectId === p.id ? projectModules : []}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </SortableContext>
                  {projectsQuery.isLoading ? (
                    <li className="app-nav__hint muted">Loading…</li>
                  ) : null}
                  {projectsQuery.isSuccess && projects.length === 0 ? (
                    <li className="app-nav__hint muted">No projects yet</li>
                  ) : null}
                  <li>
                    <Link to="/projects/new" className="app-nav__project" onClick={onNavigate}>
                      <NavIcon icon={shellIcons.add} className="app-nav__inline-icon" />
                      New project
                    </Link>
                  </li>
                </ul>
              </DndContext>
            ) : null}
          </div>
        )}
      </nav>

      <div className="app-nav__footer">
        {less ? (
          <div className="app-nav__tools app-nav__tools--less">
            {showAdmin ? (
              <button
                type="button"
                className="app-nav__icon-btn"
                onClick={onOpenPalette}
                title="Command palette (Ctrl/⌘K)"
                aria-label="Command palette"
                aria-keyshortcuts="Control+K Meta+K"
              >
                <NavIcon icon={shellIcons.search} />
              </button>
            ) : null}
            {showAdmin ? (
              <button
                type="button"
                className={`app-nav__icon-btn${adminOpen ? " is-active" : ""}`}
                onClick={() => {
                  openAdmin("users");
                  onNavigate?.();
                }}
                title="Administration"
                aria-label="Administration"
              >
                <NavIcon icon={shellIcons.admin} />
              </button>
            ) : null}
            <button
              type="button"
              className={`app-nav__icon-btn${settingsOpen ? " is-active" : ""}`}
              onClick={() => {
                openSettings("appearance");
                onNavigate?.();
              }}
              title="Settings"
              aria-label="Settings"
            >
              <NavIcon icon={shellIcons.settings} />
            </button>
            <span className="app-nav__version app-nav__version--less" title={versionTooltip}>
              v{versionMeta.version}
            </span>
          </div>
        ) : (
          <>
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
              {showAdmin ? (
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
              ) : null}
            </div>
            {showAdmin ? (
              <button
                type="button"
                className={`app-nav__item${adminOpen ? " is-active" : ""}`}
                onClick={() => {
                  openAdmin("users");
                  onNavigate?.();
                }}
              >
                <span className="app-nav__glyph" aria-hidden>
                  <NavIcon icon={shellIcons.admin} />
                </span>
                <span className="app-nav__label">Administration</span>
              </button>
            ) : null}
            <div className="app-nav__footer-sep" aria-hidden />
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
              <MeshMark className="app-nav__mesh-mark" title="" />
              <span className="app-nav__version" title={versionTooltip}>
                v{versionMeta.version}
              </span>
            </div>
            <SystemClock />
          </>
        )}
      </div>

      <ProjectSelectModal
        open={projectSelectOpen}
        activeProjectId={activeProjectId}
        onClose={() => setProjectSelectOpen(false)}
        onNavigate={onNavigate}
      />
    </aside>
  );
}
