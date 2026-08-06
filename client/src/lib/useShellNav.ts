import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchPath, useLocation, useSearchParams } from "react-router-dom";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { apiJson } from "../api/client";
import {
  isProjectModuleKey,
  MODULE_LABELS,
  type ProjectModuleKey,
} from "./projectModules";
import type { ProjectModule } from "../types";
import { shellIcons } from "../components/shell/shellIcons";

export type ContextNavItem = {
  id: string;
  label: string;
  path?: string;
  disabled?: boolean;
  title?: string;
  active?: boolean;
  icon?: IconDefinition;
  /** Pin to the bottom of the context pane (e.g. project Settings). */
  pin?: "bottom";
};

export type ShellSection =
  | "home"
  | "projects"
  | "ideas"
  | "filesystem"
  | "image-board"
  | "lists"
  | "calendar"
  | "other";

const PROJECT_MIDDLE: {
  id: string;
  label: string;
  tab: string;
  moduleKey?: ProjectModuleKey;
  icon: IconDefinition;
  pin?: "bottom";
}[] = [
  { id: "overview", label: "Overview", tab: "overview", icon: shellIcons.home },
  { id: "tasks", label: "Tasks", tab: "tasks", moduleKey: "tasks", icon: shellIcons.tasks },
  { id: "boards", label: "Kanban", tab: "boards", moduleKey: "boards", icon: shellIcons.kanban },
  {
    id: "canvases",
    label: "Canvas",
    tab: "canvases",
    moduleKey: "canvases",
    icon: shellIcons.canvas,
  },
  { id: "images", label: "Images", tab: "images", icon: shellIcons.imageBoard },
  {
    id: "wiki",
    label: "Documents (Wiki)",
    tab: "wiki",
    moduleKey: "wiki",
    icon: shellIcons.documents,
  },
  { id: "settings", label: "Settings", tab: "settings", icon: shellIcons.settings, pin: "bottom" },
];

export function useShellSection(): ShellSection {
  const { pathname } = useLocation();
  if (pathname === "/") return "home";
  if (pathname.startsWith("/projects")) return "projects";
  if (pathname.startsWith("/ideas")) return "ideas";
  if (pathname.startsWith("/filesystem")) return "filesystem";
  if (pathname.startsWith("/image-board")) return "image-board";
  if (pathname.startsWith("/todos")) return "lists";
  if (pathname.startsWith("/calendar")) return "calendar";
  return "other";
}

export function useActiveProjectId(): number | null {
  const { pathname } = useLocation();
  const match = matchPath("/projects/:id", pathname);
  if (!match?.params.id || match.params.id === "new") return null;
  const id = Number(match.params.id);
  return Number.isFinite(id) ? id : null;
}

export function useContextNavItems(): { title: string; items: ContextNavItem[] } {
  const section = useShellSection();
  const projectId = useActiveProjectId();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const modulesQuery = useQuery({
    queryKey: ["project-modules", projectId],
    enabled: projectId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: ProjectModule[] }>(
        `/api/v1/projects/${projectId}/modules`,
      );
      return res.data;
    },
  });

  return useMemo(() => {
    if (section === "projects" && projectId != null) {
      const modules = modulesQuery.data ?? [];
      const enabled = new Set(
        modules.filter((m) => m.enabled && isProjectModuleKey(m.moduleKey)).map((m) => m.moduleKey),
      );
      const rawTab = searchParams.get("tab") ?? "overview";
      const activeTab = rawTab === "todos" ? "todo_lists" : rawTab;

      const items: ContextNavItem[] = PROJECT_MIDDLE.map((entry) => {
        const needsModule = entry.moduleKey != null;
        const isEnabled = !needsModule || enabled.has(entry.moduleKey!);
        const path =
          entry.tab === "overview"
            ? `/projects/${projectId}`
            : `/projects/${projectId}?tab=${entry.tab}`;
        return {
          id: entry.id,
          label: entry.label,
          path: isEnabled ? path : undefined,
          disabled: !isEnabled,
          title: !isEnabled
            ? `Enable ${MODULE_LABELS[entry.moduleKey!]} in project Settings`
            : undefined,
          active: isEnabled && activeTab === entry.tab,
          icon: entry.icon,
          pin: entry.pin,
        };
      });

      return { title: "Project", items };
    }

    if (section === "projects") {
      return {
        title: "Projects",
        items: [
          {
            id: "all",
            label: "All projects",
            path: "/projects",
            active: location.pathname === "/projects",
            icon: shellIcons.projects,
          },
          {
            id: "new",
            label: "New project",
            path: "/projects/new",
            active: location.pathname === "/projects/new",
            icon: shellIcons.add,
          },
        ],
      };
    }

    if (section === "ideas") {
      const sort = searchParams.get("sort") ?? "date";
      return {
        title: "Ideas",
        items: [
          {
            id: "sort-date",
            label: "Date",
            path: "/ideas",
            active: sort === "date",
            icon: shellIcons.calendar,
          },
          {
            id: "sort-tag",
            label: "Tag",
            path: "/ideas?sort=tag",
            active: sort === "tag",
            icon: shellIcons.lists,
          },
          {
            id: "sort-priority",
            label: "Priority",
            disabled: true,
            title: "Priority sorting comes later",
            icon: shellIcons.tasks,
          },
        ],
      };
    }

    if (section === "lists") {
      return {
        title: "Lists",
        items: [
          {
            id: "todos",
            label: "To Do lists",
            path: "/todos",
            active: location.pathname.startsWith("/todos"),
            icon: shellIcons.lists,
          },
        ],
      };
    }

    if (section === "filesystem") {
      return {
        title: "Filesystem",
        items: [{ id: "soon", label: "Coming soon", active: true, icon: shellIcons.filesystem }],
      };
    }
    if (section === "image-board") {
      return {
        title: "Image board",
        items: [{ id: "soon", label: "Coming soon", active: true, icon: shellIcons.imageBoard }],
      };
    }
    if (section === "calendar") {
      return {
        title: "Calendar",
        items: [{ id: "soon", label: "Coming soon", active: true, icon: shellIcons.calendar }],
      };
    }

    return {
      title: "Navigate",
      items: [
        { id: "home", label: "Home", path: "/", active: location.pathname === "/", icon: shellIcons.home },
        { id: "ideas", label: "Ideas", path: "/ideas", icon: shellIcons.ideas },
        { id: "projects", label: "Projects", path: "/projects", icon: shellIcons.projects },
        { id: "lists", label: "Lists", path: "/todos", icon: shellIcons.lists },
      ],
    };
  }, [
    section,
    projectId,
    modulesQuery.data,
    searchParams,
    location.pathname,
  ]);
}
