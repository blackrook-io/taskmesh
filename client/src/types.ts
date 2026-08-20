export type Idea = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: number;
  number: number;
  name: string;
  description: string | null;
  status: string;
  sortOrder: number;
  sourceIdeaId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskGroup = {
  id: number;
  projectId: number;
  name: string;
  sortOrder: number;
  color: string | null;
  filter: { clauses: { field: string; operator: string; value: string }[]; joins: string[] } | null;
  showInNav: boolean;
  autoTagId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectPhase = {
  id: number;
  projectId: number;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type UserRef = {
  id: number;
  referenceId: string;
  displayName: string;
};

/** Full profile from GET/PATCH /users/me (extends actor embed shape). */
export type UserProfile = UserRef & {
  email: string | null;
  avatarUploadId: number | null;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  lastApiAt: string | null;
  /** True when a password hash is stored; never exposes the secret. */
  hasPassword: boolean;
};

export type Task = {
  id: number;
  projectId: number | null;
  phaseId: number | null;
  parentId: number | null;
  number: number;
  title: string;
  description: string | null;
  state: "new" | "ready" | "in_progress" | "pending" | "complete" | "canceled" | "on_hold" | "deleted";
  priority: "none" | "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  /** @deprecated Prefer dueDate */
  dueAt?: string | null;
  color: string | null;
  sortOrder: number;
  createdById?: number;
  updatedById?: number;
  createdBy?: UserRef | null;
  updatedBy?: UserRef | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskActivityEntry = {
  id: number;
  taskId: number;
  kind: "comment" | "change";
  /** Comment rows; also session summary text when field === "summary" */
  body: string | null;
  editedAt: string | null;
  /** Change rows: field name, or "summary" for a session/PATCH summary */
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  source?: "ui" | "api";
  createdById?: number | null;
  createdBy?: UserRef | null;
  createdAt: string;
};

export type ProjectDocument = {
  id: number;
  number: number;
  projectId: number;
  title: string;
  body: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type Tag = {
  id: number;
  name: string;
  color: string | null;
  createdAt: string;
  /** Present on system list / merge responses; optional for older call sites. */
  usageCount?: number;
};

export type SearchResults = {
  ideas: Idea[];
  projects: Project[];
  tasks: Task[];
  documents: ProjectDocument[];
  boards: Board[];
  canvases: CanvasSummary[];
  todo_lists: TodoList[];
  wiki: WikiNode[];
  tag: { id: number; name: string; color: string | null } | null;
};

export type TodoList = {
  id: number;
  number: number;
  projectId: number | null;
  title: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
};

export type TodoListItem = {
  id: number;
  listId: number;
  entityType: "idea" | "task";
  entityId: number;
  sortOrder: number;
  checked: boolean;
  createdAt: string;
  updatedAt: string;
  title: string;
  href: string | null;
  state?: string;
  dueDate?: string | null;
  virtual?: boolean;
};

export type TodoListDetail = TodoList & { items: TodoListItem[] };

export type ProjectModule = {
  id: number;
  projectId: number;
  moduleKey: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Board = {
  id: number;
  number: number;
  projectId: number;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Present on list endpoint */
  cardCount?: number;
};

export type BoardColumn = {
  id: number;
  boardId: number;
  name: string;
  sortOrder: number;
  wipLimit: number | null;
  createdAt: string;
  updatedAt: string;
};

export type BoardLane = {
  id: number;
  boardId: number;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type BoardCard = {
  id: number;
  boardId: number;
  columnId: number;
  laneId: number | null;
  entityType: string;
  entityId: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  title: string;
  color: string | null;
  dueAt: string | null;
};

export type BoardDetail = Board & {
  columns: BoardColumn[];
  lanes: BoardLane[];
  cards: BoardCard[];
};

export type WikiNode = {
  id: number;
  number: number;
  projectId: number;
  parentId: number | null;
  entityType: string;
  entityId: number;
  title: string;
  sortOrder: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WikiTreeNode = WikiNode & { children: WikiTreeNode[] };

export type WikiTreeResponse = {
  nodes: WikiNode[];
  tree: WikiTreeNode[];
};

export type CanvasSummary = {
  id: number;
  number: number;
  projectId: number;
  title: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Canvas = CanvasSummary & {
  document: Record<string, unknown>;
};

export type ImageBoardSummary = {
  id: number;
  number: number;
  projectId: number | null;
  projectName: string | null;
  title: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ImageBoard = ImageBoardSummary & {
  document: Record<string, unknown>;
};

export type ApiErrorBody = { error: { code: string; message: string } };

export type { EntityType } from "./lib/entityType";
export { ENTITY_TYPES, isEntityType } from "./lib/entityType";
