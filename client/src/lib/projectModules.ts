export const PROJECT_MODULE_KEYS = [
  "tasks",
  "documents",
  "todo_lists",
  "boards",
  "wiki",
  "canvases",
] as const;

export type ProjectModuleKey = (typeof PROJECT_MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ProjectModuleKey, string> = {
  tasks: "Tasks",
  documents: "Documents",
  todo_lists: "To Dos",
  boards: "Boards",
  wiki: "Wiki",
  canvases: "Canvases",
};

export const MODULE_BLURBS: Record<ProjectModuleKey, string> = {
  tasks: "Phased task list with notes, due dates, and drag reorder.",
  documents: "Standalone Markdown documents for this project.",
  todo_lists: "Mix ideas and tasks in project To Do lists.",
  boards: "Kanban planning boards for tasks.",
  wiki: "Nested wiki TOC for docs and canvases (coming soon).",
  canvases: "Diagrams and mood boards (coming soon).",
};

/** Modules that already have full UI in the project hub. */
export const IMPLEMENTED_MODULES = new Set<ProjectModuleKey>([
  "tasks",
  "documents",
  "todo_lists",
  "boards",
]);

export function isProjectModuleKey(value: string): value is ProjectModuleKey {
  return (PROJECT_MODULE_KEYS as readonly string[]).includes(value);
}
