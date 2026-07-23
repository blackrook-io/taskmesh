import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const ideas = pgTable("ideas", {
  id: serial("id").primaryKey(),
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
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("idea"),
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

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  phaseId: integer("phase_id").references(() => projectPhases.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  notes: text("notes"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projectDocuments = pgTable("project_documents", {
  id: serial("id").primaryKey(),
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

/** Nested wiki TOC nodes pointing at documents (and later canvases). */
export const wikiNodes = pgTable(
  "wiki_nodes",
  {
    id: serial("id").primaryKey(),
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

export const ideasRelations = relations(ideas, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  sourceIdea: one(ideas, {
    fields: [projects.sourceIdeaId],
    references: [ideas.id],
  }),
  phases: many(projectPhases),
  tasks: many(tasks),
  documents: many(projectDocuments),
  todoLists: many(todoLists),
  modules: many(projectModules),
  boards: many(boards),
  wikiNodes: many(wikiNodes),
}));

export const projectPhasesRelations = relations(projectPhases, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectPhases.projectId],
    references: [projects.id],
  }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  phase: one(projectPhases, {
    fields: [tasks.phaseId],
    references: [projectPhases.id],
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
