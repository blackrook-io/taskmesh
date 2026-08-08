import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchPath, useLocation, useSearchParams } from "react-router-dom";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { apiJson } from "../api/client";
import {
  isProjectModuleKey,
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
  { id: "settings", label: "Settings", tab: "settings", icon: shellIcons.settings, pin: "bottom" },
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

      const items: ContextNavItem[] = PROJECT_MIDDLE.flatMap((entry) => {
        const needsModule = entry.moduleKey != null;
        const isEnabled = !needsModule || enabled.has(entry.moduleKey!);
        if (needsModule && !isEnabled) return [];
        const path =
          entry.tab === "overview"
            ? `/projects/${projectId}`
            : `/projects/${projectId}?tab=${entry.tab}`;
        return [
          {
            id: entry.id,
            label: entry.label,
            path,
            active: activeTab === entry.tab,
            icon: entry.icon,
            pin: entry.pin,
          },
        ];
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
            label: l.kind === "inbox" ? "Unsorted" : l.title,
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
            label: b.title,
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
    modulesQuery.data,
    listsQuery.data,
    imageBoardsQuery.data,
    searchParams,
    location.pathname,
  ]);
}
