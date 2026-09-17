import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchPath, useLocation, useSearchParams } from "react-router-dom";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { apiJson } from "../api/client";
import { formatEntityRef } from "./entityRef";
import {
  isProjectModuleKey,
  type ProjectModuleKey,
} from "./projectModules";
import type { ProjectModule, TaskGroup, Project } from "../types";
import { shellIcons } from "../components/shell/shellIcons";
import { isFilterActive, parseTaskListFilterValue } from "./taskListFilter";
import { useAuth } from "./auth";
import { userIsAdministrator } from "./roles";

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
  /** Indent under a parent item (Task Group sub-lists). */
  nested?: boolean;
  /** Optional color chip instead of (or in the glyph slot with) the icon. */
  swatch?: string | null;
};

export type ShellSection =
  | "home"
  | "projects"
  | "ideas"
  | "tasks"
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
  {
    id: "todo_lists",
    label: "To Dos",
    tab: "todo_lists",
    moduleKey: "todo_lists",
    icon: shellIcons.lists,
  },
  {
    id: "documents",
    label: "Documents",
    tab: "documents",
    moduleKey: "documents",
    icon: shellIcons.documents,
  },
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
    label: "Wiki",
    tab: "wiki",
    moduleKey: "wiki",
    icon: shellIcons.documents,
  },
  {
    id: "settings",
    label: "Settings",
    tab: "settings",
    icon: shellIcons.projectSettings,
    pin: "bottom",
  },
];

export function useShellSection(): ShellSection {
  const { pathname } = useLocation();
  if (pathname === "/") return "home";
  if (pathname.startsWith("/projects")) return "projects";
  if (pathname.startsWith("/ideas")) return "ideas";
  if (pathname.startsWith("/tasks")) return "tasks";
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

/** Project module submenu for the active `/projects/:id` route (nested under AppNav). */
export function useActiveProjectNavItems(): {
  title: string;
  titleTooltip?: string;
  items: ContextNavItem[];
} {
  const projectId = useActiveProjectId();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const isAdmin = userIsAdministrator(user);

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

  const groupsQuery = useQuery({
    queryKey: ["task-groups", projectId],
    enabled: projectId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: TaskGroup[] }>(
        `/api/v1/projects/${projectId}/groups`,
      );
      return res.data;
    },
  });

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    enabled: projectId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: Project }>(`/api/v1/projects/${projectId}`);
      return res.data;
    },
  });

  return useMemo(() => {
    if (projectId == null) {
      return { title: "", items: [] as ContextNavItem[] };
    }

    const modules = modulesQuery.data ?? [];
    const enabled = new Set(
      modules.filter((m) => m.enabled && isProjectModuleKey(m.moduleKey)).map((m) => m.moduleKey),
    );
    const rawTab = searchParams.get("tab") ?? "overview";
    const activeTab = rawTab === "todos" ? "todo_lists" : rawTab;
    const rawGroup = searchParams.get("group");
    const navGroupId = rawGroup != null && rawGroup !== "" ? Number(rawGroup) : NaN;
    const groupParamOn = Number.isFinite(navGroupId);
    const pinnedGroups = (groupsQuery.data ?? []).filter((g) => {
      if (!g.showInNav) return false;
      const parsed = parseTaskListFilterValue(g.filter);
      return parsed != null && isFilterActive(parsed);
    });

    const items: ContextNavItem[] = PROJECT_MIDDLE.flatMap((entry) => {
      const canManageSettings = isAdmin || projectQuery.data?.canManageSettings === true;
      if (entry.tab === "settings" && !canManageSettings) return [];
      const needsModule = entry.moduleKey != null;
      const isEnabled = !needsModule || enabled.has(entry.moduleKey!);
      if (needsModule && !isEnabled) return [];
      const path =
        entry.tab === "overview"
          ? `/projects/${projectId}`
          : `/projects/${projectId}?tab=${entry.tab}`;
      const isTasks = entry.tab === "tasks";
      const parent: ContextNavItem = {
        id: entry.id,
        label: entry.label,
        path,
        active: isTasks ? activeTab === "tasks" && !groupParamOn : activeTab === entry.tab,
        icon: entry.icon,
        pin: entry.pin,
      };
      if (!isTasks) return [parent];
      const children: ContextNavItem[] = pinnedGroups.map((g) => ({
        id: `task-group-${g.id}`,
        label: g.name,
        path: `/projects/${projectId}?tab=tasks&group=${g.id}`,
        active: activeTab === "tasks" && groupParamOn && navGroupId === g.id,
        nested: true,
        swatch: g.color,
        icon: shellIcons.tasks,
      }));
      return [parent, ...children];
    });

    return {
      title: projectQuery.data?.name ?? "…",
      titleTooltip: projectQuery.data
        ? formatEntityRef("project", projectQuery.data.number)
        : undefined,
      items,
    };
  }, [
    projectId,
    projectQuery.data,
    modulesQuery.data,
    groupsQuery.data,
    searchParams,
    isAdmin,
  ]);
}
