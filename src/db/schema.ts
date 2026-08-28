import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
  /** Record owner (T0112). Access scoped in T0113–T0115. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
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
  /** Record owner (T0112). Nested project content inherits this for access. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** List-view Task Groups (saved filter + color). Distinct from Project Phases. */
export const taskGroups = pgTable("task_groups", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Accent on the group bar (CSS hex). */
  color: text("color"),
  /** T0053-shaped filter JSON; null/empty = manual membership via task_group_members. */
  filter: jsonb("filter").$type<{
    clauses: { field: string; operator: string; value: string }[];
    joins: string[];
  } | null>(),
  /** When true and filter is active, list under Tasks in the Project menu. */
  showInNav: boolean("show_in_nav").notNull().default(false),
  /** Optional tag applied to tasks that match this group’s filter (T0077). */
  autoTagId: integer("auto_tag_id").references(() => tags.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Project development phases. Tasks optionally associate via phase_id. */
export const projectPhases = pgTable("project_phases", {
  id: serial("id").primaryKey(),
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

/** App users. Display → U####. */
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
  /** Set when login-failure threshold is hit, or when an admin locks the account. */
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

/** Browser login sessions (opaque id in httpOnly cookie). */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Reserved for session timeout enforcement (T0096 stores; middleware enforces later). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/**
 * Prior password hashes for reuse rejection (T0109).
 * Current hash lives on `users.password_hash`; this table holds up to 4 older hashes
 * so Profile change rejects any of the last 5 passwords (current + 4 prior).
 */
export const passwordHistory = pgTable(
  "password_history",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** scrypt hash (same format as users.password_hash). */
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("password_history_user_created_idx").on(t.userId, t.createdAt)],
);

/** Named roles. System `administrator` is seeded and protected (T0108). */
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** User ↔ role membership. */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index("user_roles_role_id_idx").on(t.roleId),
  ],
);

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
  /** Request Content-Length (ingress estimate), bytes. */
  requestBytes: integer("request_bytes").notNull().default(0),
  /** Response body bytes sent to the client (egress estimate). */
  responseBytes: integer("response_bytes").notNull().default(0),
});

/** Periodic Postgres gauges for Administration → Database charts. */
export const dbStatsSnapshots = pgTable(
  "db_stats_snapshots",
  {
    id: serial("id").primaryKey(),
    sampledAt: timestamp("sampled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** pg_database_size of the connected app database. */
    databaseSizeBytes: bigint("database_size_bytes", { mode: "number" }).notNull(),
    /** User tables in the app database (pg_stat_user_tables). */
    tableCount: integer("table_count").notNull(),
    /** Always 1 — only the connected app database is counted. */
    databaseCount: integer("database_count").notNull(),
    datname: text("datname").notNull(),
  },
  (t) => ({
    sampledAtIdx: index("db_stats_snapshots_sampled_at_idx").on(t.sampledAt),
  }),
);

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  /** Null when task lives only in Lists / Unsorted (not project-scoped). */
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  /** Optional Project Phase (not Task Group membership). */
  phaseId: integer("phase_id").references(() => projectPhases.id, {
    onDelete: "set null",
  }),
  parentId: integer("parent_id").references((): AnyPgColumn => tasks.id, {
    onDelete: "set null",
  }),
  /** App-wide unique display number → T####. */
  number: integer("number").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  /** new (Draft) | ready | in_progress | pending | complete | canceled | on_hold | deleted */
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
  /** Record owner (T0112). Unsorted tasks use this; project tasks also stamped. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Manual members for Task Groups with no active filter (List View drag-into). */
export const taskGroupMembers = pgTable(
  "task_group_members",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => taskGroups.id, { onDelete: "cascade" }),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    groupTaskUniq: unique("task_group_members_group_task_uidx").on(t.groupId, t.taskId),
  }),
);

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
  /** Creator-owned (T0112). Global templates still scoped to owner (+ admin). */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
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

export const uploads = pgTable("uploads", {
  id: serial("id").primaryKey(),
  /** Stored filename on disk (UUID + extension). */
  storedName: text("stored_name").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  /** Record owner (T0112). GET/delete scoped in T0114. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tags = pgTable(
  "tags",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    color: text("color"),
    /** Per-user tags (T0112). Uniqueness is (owner_id, name). */
    ownerId: integer("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerNameUniq: unique("tags_owner_id_name_uidx").on(t.ownerId, t.name),
  }),
);

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

/**
 * First-class ToDo records (UI: "ToDo"; display D####).
 * Lighter than Task: scheduled work without full task hierarchy/phases.
 */
export const todos = pgTable("todos", {
  id: serial("id").primaryKey(),
  /** Null when not project-scoped (same idea as tasks). */
  projectId: integer("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  /** App-wide unique display number → D####. */
  number: integer("number").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  /** Same values as tasks.state (including soft-delete `deleted`). */
  state: text("state").notNull().default("new"),
  /** none | low | medium | high | urgent */
  priority: text("priority").notNull().default("none"),
  /** Date-only due date (YYYY-MM-DD). */
  dueDate: date("due_date", { mode: "string" }),
  /** When this ToDo should be acted on. */
  actionBy: timestamp("action_by", { withTimezone: true }),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Set when created by converting an Idea. */
  sourceIdeaId: integer("source_idea_id").references(() => ideas.id, {
    onDelete: "set null",
  }),
  createdById: integer("created_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  updatedById: integer("updated_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  /** Record owner (T0112). Unsorted todos use this; project todos also stamped. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
  /** Record owner (T0112). Standalone lists use this; project lists also stamped. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Polymorphic list rows. New memberships: `todo` | `task`.
 * Legacy `idea` rows may remain (no data migration); read/remove only.
 */
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
  /** Record owner (T0112). Standalone boards use this; project boards also stamped. */
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ideasRelations = relations(ideas, ({ one, many }) => ({
  owner: one(users, {
    fields: [ideas.ownerId],
    references: [users.id],
    relationName: "idea_owner",
  }),
  projects: many(projects),
  todos: many(todos),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  sourceIdea: one(ideas, {
    fields: [projects.sourceIdeaId],
    references: [ideas.id],
  }),
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id],
    relationName: "project_owner",
  }),
  taskGroups: many(taskGroups),
  phases: many(projectPhases),
  tasks: many(tasks),
  todos: many(todos),
  documents: many(projectDocuments),
  todoLists: many(todoLists),
  modules: many(projectModules),
  boards: many(boards),
  wikiNodes: many(wikiNodes),
  canvases: many(canvases),
  imageBoards: many(imageBoards),
}));

export const todosRelations = relations(todos, ({ one }) => ({
  project: one(projects, {
    fields: [todos.projectId],
    references: [projects.id],
  }),
  sourceIdea: one(ideas, {
    fields: [todos.sourceIdeaId],
    references: [ideas.id],
  }),
  createdBy: one(users, {
    fields: [todos.createdById],
    references: [users.id],
    relationName: "todo_created_by",
  }),
  updatedBy: one(users, {
    fields: [todos.updatedById],
    references: [users.id],
    relationName: "todo_updated_by",
  }),
  owner: one(users, {
    fields: [todos.ownerId],
    references: [users.id],
    relationName: "todo_owner",
  }),
}));

export const taskGroupsRelations = relations(taskGroups, ({ one, many }) => ({
  project: one(projects, {
    fields: [taskGroups.projectId],
    references: [projects.id],
  }),
  autoTag: one(tags, {
    fields: [taskGroups.autoTagId],
    references: [tags.id],
  }),
  members: many(taskGroupMembers),
}));

export const taskGroupMembersRelations = relations(taskGroupMembers, ({ one }) => ({
  group: one(taskGroups, {
    fields: [taskGroupMembers.groupId],
    references: [taskGroups.id],
  }),
  task: one(tasks, {
    fields: [taskGroupMembers.taskId],
    references: [tasks.id],
  }),
}));

export const projectPhasesRelations = relations(projectPhases, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectPhases.projectId],
    references: [projects.id],
  }),
  tasks: many(tasks),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  avatarUpload: one(uploads, {
    fields: [users.avatarUploadId],
    references: [uploads.id],
  }),
  createdTasks: many(tasks, { relationName: "task_created_by" }),
  updatedTasks: many(tasks, { relationName: "task_updated_by" }),
  ownedTasks: many(tasks, { relationName: "task_owner" }),
  createdTodos: many(todos, { relationName: "todo_created_by" }),
  updatedTodos: many(todos, { relationName: "todo_updated_by" }),
  ownedTodos: many(todos, { relationName: "todo_owner" }),
  ownedIdeas: many(ideas, { relationName: "idea_owner" }),
  ownedProjects: many(projects, { relationName: "project_owner" }),
  ownedUploads: many(uploads, { relationName: "upload_owner" }),
  ownedTags: many(tags, { relationName: "tag_owner" }),
  ownedTodoLists: many(todoLists, { relationName: "todo_list_owner" }),
  ownedImageBoards: many(imageBoards, { relationName: "image_board_owner" }),
  createdTaskDescriptionTemplates: many(taskDescriptionTemplates, {
    relationName: "task_description_templates_created_by",
  }),
  updatedTaskDescriptionTemplates: many(taskDescriptionTemplates, {
    relationName: "task_description_templates_updated_by",
  }),
  ownedTaskDescriptionTemplates: many(taskDescriptionTemplates, {
    relationName: "task_description_templates_owner",
  }),
  apiKeys: many(apiKeys),
  userRoles: many(userRoles),
  passwordHistory: many(passwordHistory),
}));

export const passwordHistoryRelations = relations(passwordHistory, ({ one }) => ({
  user: one(users, {
    fields: [passwordHistory.userId],
    references: [users.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
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
    owner: one(users, {
      fields: [taskDescriptionTemplates.ownerId],
      references: [users.id],
      relationName: "task_description_templates_owner",
    }),
  }),
);

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  phase: one(projectPhases, {
    fields: [tasks.phaseId],
    references: [projectPhases.id],
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
  owner: one(users, {
    fields: [tasks.ownerId],
    references: [users.id],
    relationName: "task_owner",
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
  updatedBy: one(users, {
    fields: [projectDocuments.updatedById],
    references: [users.id],
  }),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  owner: one(users, {
    fields: [tags.ownerId],
    references: [users.id],
    relationName: "tag_owner",
  }),
  taggings: many(taggings),
  taskGroups: many(taskGroups),
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
  owner: one(users, {
    fields: [todoLists.ownerId],
    references: [users.id],
    relationName: "todo_list_owner",
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
  owner: one(users, {
    fields: [imageBoards.ownerId],
    references: [users.id],
    relationName: "image_board_owner",
  }),
}));
