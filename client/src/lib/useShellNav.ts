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

export function useContextNavItems(): {
  title: string;
  titleTooltip?: string;
  items: ContextNavItem[];
} {
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
    enabled: section === "projects" && projectId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: Project }>(`/api/v1/projects/${projectId}`);
      return res.data;
    },
  });

  const listsQuery = useQuery({
    queryKey: ["todo-lists", "global"],
    enabled: section === "lists",
    queryFn: async () => {
      const res = await apiJson<{ data: import("../types").TodoList[] }>(
        "/api/v1/todo-lists?projectId=null",
      );
      return res.data;
    },
  });

  const imageBoardsQuery = useQuery({
    queryKey: ["image-boards", "all"],
    enabled: section === "image-board",
    queryFn: async () => {
      const res = await apiJson<{ data: import("../types").ImageBoardSummary[] }>(
        "/api/v1/image-boards",
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
      const rawGroup = searchParams.get("group");
      const navGroupId = rawGroup != null && rawGroup !== "" ? Number(rawGroup) : NaN;
      const groupParamOn = Number.isFinite(navGroupId);
      const pinnedGroups = (groupsQuery.data ?? []).filter((g) => {
        if (!g.showInNav) return false;
        const parsed = parseTaskListFilterValue(g.filter);
        return parsed != null && isFilterActive(parsed);
      });

      const items: ContextNavItem[] = PROJECT_MIDDLE.flatMap((entry) => {
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
      const order = searchParams.get("order") === "asc" ? "asc" : "desc";
      const flip = order === "desc" ? "asc" : "desc";
      const sortLink = (key: string, active: boolean) => {
        const nextOrder = active ? flip : key === "title" ? "asc" : "desc";
        return `/ideas?sort=${key}&order=${nextOrder}`;
      };
      return {
        title: "Ideas",
        items: [
          {
            id: "sort-date",
            label: order === "asc" && sort === "date" ? "Date created ↑" : "Date created",
            path: sortLink("date", sort === "date"),
            active: sort === "date",
            icon: shellIcons.calendar,
          },
          {
            id: "sort-title",
            label: order === "desc" && sort === "title" ? "Title ↓" : "Title A–Z",
            path: sortLink("title", sort === "title"),
            active: sort === "title",
            icon: shellIcons.documents,
          },
          {
            id: "sort-tag",
            label: order === "asc" && sort === "tag" ? "Tags ↑" : "Grouped by Tags",
            path: sortLink("tag", sort === "tag"),
            active: sort === "tag",
            icon: shellIcons.lists,
          },
        ],
      };
    }

    if (section === "tasks") {
      const filter = searchParams.get("filter") ?? "all";
      return {
        title: "Tasks",
        items: [
          {
            id: "all",
            label: "All tasks",
            path: "/tasks",
            active: filter === "all" || !searchParams.get("filter"),
            icon: shellIcons.tasks,
          },
          {
            id: "unassigned",
            label: "Unassigned",
            path: "/tasks?filter=unassigned",
            active: filter === "unassigned",
            icon: shellIcons.lists,
          },
        ],
      };
    }

    if (section === "lists") {
      const listMatch = matchPath("/todos/:listId", location.pathname);
      const activeListId = listMatch?.params.listId ? Number(listMatch.params.listId) : null;
      return {
        title: "Lists",
        items: [
          ...(listsQuery.data ?? []).map((l) => ({
            id: `list-${l.id}`,
            label:
              l.kind === "inbox"
                ? "Unsorted"
                : `${formatEntityRef("todo_list", l.number)} ${l.title}`,
            path: `/todos/${l.id}`,
            active: activeListId === l.id || (activeListId == null && l.kind === "inbox" && location.pathname === "/todos"),
            icon: shellIcons.lists,
          })),
          {
            id: "create-list",
            label: "Create list",
            path: "/todos?create=1",
            active: searchParams.get("create") === "1",
            icon: shellIcons.add,
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
      const boards = imageBoardsQuery.data ?? [];
      const editorMatch = matchPath("/image-board/:id", location.pathname);
      const activeId = editorMatch?.params.id ? Number(editorMatch.params.id) : null;
      return {
        title: "Image board",
        items: [
          {
            id: "all-boards",
            label: "All boards",
            path: "/image-board",
            active: location.pathname === "/image-board",
            icon: shellIcons.imageBoard,
          },
          ...boards.map((b) => ({
            id: `ib-${b.id}`,
            label: `${formatEntityRef("image_board", b.number)} ${b.title}`,
            path: `/image-board/${b.id}`,
            active: activeId === b.id,
            icon: shellIcons.imageBoard,
          })),
        ],
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
        { id: "tasks", label: "Tasks", path: "/tasks", icon: shellIcons.tasks },
        { id: "projects", label: "Projects", path: "/projects", icon: shellIcons.projects },
        { id: "lists", label: "Lists", path: "/todos", icon: shellIcons.lists },
      ],
    };
  }, [
    section,
    projectId,
    projectQuery.data,
    modulesQuery.data,
    groupsQuery.data,
    listsQuery.data,
    imageBoardsQuery.data,
    searchParams,
    location.pathname,
  ]);
}
