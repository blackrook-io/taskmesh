import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const ideas = pgTable("ideas", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → I####. */
  number: integer("number").notNull().unique(),
  title: text("title").notNull(),
  body: text("body"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → P####. */
  number: integer("number").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("idea"),
  /** Manual list order (left nav / project list). */
  sortOrder: integer("sort_order").notNull().default(0),
  /** Set when an idea was converted into this project. */
  sourceIdeaId: integer("source_idea_id").references(() => ideas.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** List-view Task Groups (saved filter + color). Not the future Project Phase field. */
export const taskGroups = pgTable("task_groups", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Accent on the group bar (CSS hex). */
  color: text("color"),
  /** T0053-shaped filter JSON; null/empty = no tasks under this group. */
  filter: jsonb("filter").$type<{
    clauses: { field: string; operator: string; value: string }[];
    joins: string[];
  } | null>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** App users (single-user now; auth later). Display → U####. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → U####. */
  number: integer("number").notNull().unique(),
  displayName: text("display_name").notNull(),
  /** FK to uploads; ON DELETE SET NULL. Declared after uploads via lazy ref. */
  avatarUploadId: integer("avatar_upload_id").references(
    (): AnyPgColumn => uploads.id,
    { onDelete: "set null" },
  ),
  /** Unique among non-null (Postgres UNIQUE allows multiple NULLs). */
  email: text("email").unique(),
  /** scrypt hash; set via admin reset / future Profile (T0062). */
  passwordHash: text("password_hash"),
  /** Null = active; set when admin deactivates the user. */
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  /** Failed login attempts; written when auth exists. */
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  /** Set when login-failure threshold is hit (future auth). */
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  /** Last UI auth/access — written when auth exists. */
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  /** Last API-key usage — written when API keys exist. */
  lastApiAt: timestamp("last_api_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** API keys (admin bridge; Profile CRUD + enforcement in T0063). */
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Public display prefix, e.g. taskmesh_rw_ab12. */
  prefix: text("prefix").notNull(),
  /** Hash of the full secret key; never returned after create. */
  keyHash: text("key_hash").notNull(),
  /** readonly | readwrite */
  access: text("access").notNull().default("readwrite"),
  /** active | suspended | expired | revoked */
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** System-wide editable properties (enforcement later). */
export const systemProperties = pgTable("system_properties", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Append-only API request / auth audit log for Admin APIs + Logging. */
export const apiRequestLogs = pgTable("api_request_logs", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** success | api_failure | auth_failure | access_violation */
  outcome: text("outcome").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code").notNull(),
  ip: text("ip"),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  apiKeyId: integer("api_key_id").references(() => apiKeys.id, {
    onDelete: "set null",
  }),
  message: text("message"),
  /** True when request used an admin-owned key (audit flag). */
  adminKey: boolean("admin_key").notNull().default(false),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  /** Null when task lives only in Lists / Unsorted (not project-scoped). */
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  /** Unused for list grouping (T0075). Kept for T0080 Project Phase; no FK. */
  phaseId: integer("phase_id"),
  parentId: integer("parent_id").references((): AnyPgColumn => tasks.id, {
    onDelete: "set null",
  }),
  /** App-wide unique display number → T####. */
  number: integer("number").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  /** new (Draft) | ready | in_progress | complete | canceled | on_hold | deleted */
  state: text("state").notNull().default("new"),
  /** none | low | medium | high | urgent */
  priority: text("priority").notNull().default("none"),
  /** Date-only due date (YYYY-MM-DD). */
  dueDate: date("due_date", { mode: "string" }),
  /** @deprecated Prefer dueDate; kept for migration compatibility. */
  dueAt: timestamp("due_at", { withTimezone: true }),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdById: integer("created_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  updatedById: integer("updated_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Reusable Markdown bodies for Task Description (project-scoped or Global). */
export const taskDescriptionTemplates = pgTable("task_description_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  /** Null when saved from an unsorted / non-project task. */
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  /** When true, available on all tasks regardless of project. */
  isGlobal: boolean("is_global").notNull().default(false),
  createdById: integer("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedById: integer("updated_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Task history timeline: user comments + auto-recorded field changes. */
export const taskActivity = pgTable("task_activity", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  /** comment | change */
  kind: text("kind").notNull(),
  /** Comment rows: Markdown body and last-edit timestamp. */
  body: text("body"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  /**
   * Change rows: which field and its before/after display values.
   * Session summaries use field=`summary` with the concise text in `body`.
   */
  field: text("field"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  /** Actor who authored the comment / change (nullable for legacy rows). */
  createdById: integer("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  /** `ui` = SPA (`X-TaskMesh-Client: ui`); otherwise `api`. */
  source: text("source").notNull().default("api"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Directed blocking edges: `taskId` Depends on `dependsOnTaskId`.
 * Inverse view = Required by. Separate from parentId hierarchy.
 */
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: integer("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pairUniq: unique("task_dependencies_pair_uidx").on(t.taskId, t.dependsOnTaskId),
  }),
);

export const projectDocuments = pgTable("project_documents", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → D####. */
  number: integer("number").notNull().unique(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const uploads = pgTable("uploads", {
  id: serial("id").primaryKey(),
  /** Stored filename on disk (UUID + extension). */
  storedName: text("stored_name").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Polymorphic join: tag ↔ (entity_type, entity_id). */
export const taggings = pgTable(
  "taggings",
  {
    id: serial("id").primaryKey(),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
  },
  (t) => ({
    tagEntityUniq: unique("taggings_tag_entity_uidx").on(
      t.tagId,
      t.entityType,
      t.entityId,
    ),
  }),
);

/** Standalone or project-scoped checklist containers. */
export const todoLists = pgTable("todo_lists", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → L####. */
  number: integer("number").notNull().unique(),
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("list"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Polymorphic list rows: idea or task. */
export const todoListItems = pgTable(
  "todo_list_items",
  {
    id: serial("id").primaryKey(),
    listId: integer("list_id")
      .notNull()
      .references(() => todoLists.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    checked: boolean("checked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    listEntityUniq: unique("todo_list_items_list_entity_uidx").on(
      t.listId,
      t.entityType,
      t.entityId,
    ),
  }),
);

/** Per-project enablement of hub modules (tasks, wiki, boards, …). */
export const projectModules = pgTable(
  "project_modules",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    projectModuleUniq: unique("project_modules_project_key_uidx").on(t.projectId, t.moduleKey),
  }),
);

/** Kanban planning boards (multiple per project). */
export const boards = pgTable("boards", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → B####. */
  number: integer("number").notNull().unique(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const boardColumns = pgTable("board_columns", {
  id: serial("id").primaryKey(),
  boardId: integer("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  wipLimit: integer("wip_limit"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const boardLanes = pgTable("board_lanes", {
  id: serial("id").primaryKey(),
  boardId: integer("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Cards point at tasks (and later other entities). */
export const boardCards = pgTable(
  "board_cards",
  {
    id: serial("id").primaryKey(),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    columnId: integer("column_id")
      .notNull()
      .references(() => boardColumns.id, { onDelete: "cascade" }),
    laneId: integer("lane_id").references(() => boardLanes.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    boardEntityUniq: unique("board_cards_board_entity_uidx").on(
      t.boardId,
      t.entityType,
      t.entityId,
    ),
  }),
);

/** Nested wiki TOC nodes pointing at documents or canvases. */
export const wikiNodes = pgTable(
  "wiki_nodes",
  {
    id: serial("id").primaryKey(),
    /** App-wide unique display number → W####. */
    number: integer("number").notNull().unique(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: integer("parent_id").references((): AnyPgColumn => wikiNodes.id, {
      onDelete: "cascade",
    }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    projectEntityUniq: unique("wiki_nodes_project_entity_uidx").on(
      t.projectId,
      t.entityType,
      t.entityId,
    ),
  }),
);

/** Freeform Excalidraw documents scoped to a project. */
export const canvases = pgTable("canvases", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → C####. */
  number: integer("number").notNull().unique(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Excalidraw scene JSON (elements / appState / files). */
  document: jsonb("document")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** PureRef-style image boards; optional project association. */
export const imageBoards = pgTable("image_boards", {
  id: serial("id").primaryKey(),
  /** App-wide unique display number → M####. */
  number: integer("number").notNull().unique(),
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Scene JSON: camera, gridVisible, items (images / text / boxes). */
  document: jsonb("document")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ideasRelations = relations(ideas, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  sourceIdea: one(ideas, {
    fields: [projects.sourceIdeaId],
    references: [ideas.id],
  }),
  taskGroups: many(taskGroups),
  tasks: many(tasks),
  documents: many(projectDocuments),
  todoLists: many(todoLists),
  modules: many(projectModules),
  boards: many(boards),
  wikiNodes: many(wikiNodes),
  canvases: many(canvases),
  imageBoards: many(imageBoards),
}));

export const taskGroupsRelations = relations(taskGroups, ({ one }) => ({
  project: one(projects, {
    fields: [taskGroups.projectId],
    references: [projects.id],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  avatarUpload: one(uploads, {
    fields: [users.avatarUploadId],
    references: [uploads.id],
  }),
  createdTasks: many(tasks, { relationName: "task_created_by" }),
  updatedTasks: many(tasks, { relationName: "task_updated_by" }),
  createdTaskDescriptionTemplates: many(taskDescriptionTemplates, {
    relationName: "task_description_templates_created_by",
  }),
  updatedTaskDescriptionTemplates: many(taskDescriptionTemplates, {
    relationName: "task_description_templates_updated_by",
  }),
  apiKeys: many(apiKeys),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export const apiRequestLogsRelations = relations(apiRequestLogs, ({ one }) => ({
  user: one(users, {
    fields: [apiRequestLogs.userId],
    references: [users.id],
  }),
  apiKey: one(apiKeys, {
    fields: [apiRequestLogs.apiKeyId],
    references: [apiKeys.id],
  }),
}));

export const taskDescriptionTemplatesRelations = relations(
  taskDescriptionTemplates,
  ({ one }) => ({
    project: one(projects, {
      fields: [taskDescriptionTemplates.projectId],
      references: [projects.id],
    }),
    createdBy: one(users, {
      fields: [taskDescriptionTemplates.createdById],
      references: [users.id],
      relationName: "task_description_templates_created_by",
    }),
    updatedBy: one(users, {
      fields: [taskDescriptionTemplates.updatedById],
      references: [users.id],
      relationName: "task_description_templates_updated_by",
    }),
  }),
);

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  parent: one(tasks, {
    fields: [tasks.parentId],
    references: [tasks.id],
    relationName: "task_hierarchy",
  }),
  children: many(tasks, { relationName: "task_hierarchy" }),
  createdBy: one(users, {
    fields: [tasks.createdById],
    references: [users.id],
    relationName: "task_created_by",
  }),
  updatedBy: one(users, {
    fields: [tasks.updatedById],
    references: [users.id],
    relationName: "task_updated_by",
  }),
  activity: many(taskActivity),
  dependencies: many(taskDependencies, { relationName: "task_depends_on" }),
  requiredBy: many(taskDependencies, { relationName: "task_required_by" }),
}));

export const taskActivityRelations = relations(taskActivity, ({ one }) => ({
  task: one(tasks, {
    fields: [taskActivity.taskId],
    references: [tasks.id],
  }),
  createdBy: one(users, {
    fields: [taskActivity.createdById],
    references: [users.id],
  }),
}));

export const taskDependenciesRelations = relations(taskDependencies, ({ one }) => ({
  task: one(tasks, {
    fields: [taskDependencies.taskId],
    references: [tasks.id],
    relationName: "task_depends_on",
  }),
  dependsOn: one(tasks, {
    fields: [taskDependencies.dependsOnTaskId],
    references: [tasks.id],
    relationName: "task_required_by",
  }),
}));

export const projectDocumentsRelations = relations(projectDocuments, ({ one }) => ({
  project: one(projects, {
    fields: [projectDocuments.projectId],
    references: [projects.id],
  }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  taggings: many(taggings),
}));

export const taggingsRelations = relations(taggings, ({ one }) => ({
  tag: one(tags, {
    fields: [taggings.tagId],
    references: [tags.id],
  }),
}));

export const todoListsRelations = relations(todoLists, ({ one, many }) => ({
  project: one(projects, {
    fields: [todoLists.projectId],
    references: [projects.id],
  }),
  items: many(todoListItems),
}));

export const todoListItemsRelations = relations(todoListItems, ({ one }) => ({
  list: one(todoLists, {
    fields: [todoListItems.listId],
    references: [todoLists.id],
  }),
}));

export const projectModulesRelations = relations(projectModules, ({ one }) => ({
  project: one(projects, {
    fields: [projectModules.projectId],
    references: [projects.id],
  }),
}));

export const boardsRelations = relations(boards, ({ one, many }) => ({
  project: one(projects, {
    fields: [boards.projectId],
    references: [projects.id],
  }),
  columns: many(boardColumns),
  lanes: many(boardLanes),
  cards: many(boardCards),
}));

export const boardColumnsRelations = relations(boardColumns, ({ one, many }) => ({
  board: one(boards, {
    fields: [boardColumns.boardId],
    references: [boards.id],
  }),
  cards: many(boardCards),
}));

export const boardLanesRelations = relations(boardLanes, ({ one, many }) => ({
  board: one(boards, {
    fields: [boardLanes.boardId],
    references: [boards.id],
  }),
  cards: many(boardCards),
}));

export const boardCardsRelations = relations(boardCards, ({ one }) => ({
  board: one(boards, {
    fields: [boardCards.boardId],
    references: [boards.id],
  }),
  column: one(boardColumns, {
    fields: [boardCards.columnId],
    references: [boardColumns.id],
  }),
  lane: one(boardLanes, {
    fields: [boardCards.laneId],
    references: [boardLanes.id],
  }),
}));

export const wikiNodesRelations = relations(wikiNodes, ({ one, many }) => ({
  project: one(projects, {
    fields: [wikiNodes.projectId],
    references: [projects.id],
  }),
  parent: one(wikiNodes, {
    fields: [wikiNodes.parentId],
    references: [wikiNodes.id],
    relationName: "wiki_tree",
  }),
  children: many(wikiNodes, { relationName: "wiki_tree" }),
}));

export const canvasesRelations = relations(canvases, ({ one }) => ({
  project: one(projects, {
    fields: [canvases.projectId],
    references: [projects.id],
  }),
}));

export const imageBoardsRelations = relations(imageBoards, ({ one }) => ({
  project: one(projects, {
    fields: [imageBoards.projectId],
    references: [projects.id],
  }),
}));
