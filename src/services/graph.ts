import { and, eq, inArray, isNotNull, max, ne, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { formatEntityRef } from "../lib/entityRef.js";
import { isEntityType, type EntityType } from "../lib/entityType.js";
import { LINK_RELATIONS } from "../lib/entityLinkRules.js";
import {
  graphNodeKey,
  walkNeighbourhood,
  type GraphEdge,
  type GraphNeighbour,
} from "../lib/graphWalk.js";
import { loadVisibleEnds, type LinkActor } from "./entityLinks.js";
import { hrefFor } from "./references.js";

type Db = NodePgDatabase<typeof schema>;

export const GRAPH_NODE_CAP = 300;

const DONE_STATES = new Set(["complete", "canceled"]);

export type GraphNode = {
  key: string;
  type: string;
  id: number;
  referenceId: string | null;
  title: string;
  state: string | null;
  progress: number | null;
  priority: string | null;
  /** Date-only due date (YYYY-MM-DD). */
  dueDate: string | null;
  createdAt: string | null;
  /** Latest state change for a task; otherwise the record's updatedAt. */
  signalAt: string | null;
  projectId: number | null;
  href: string | null;
};

type Ref = { type: string; id: number };

type Provisional = {
  edge: GraphEdge;
  otherKey: string;
};

function parseKey(key: string): Ref | null {
  const match = /^([a-z_]+):(\d+)$/.exec(key);
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { type: match[1]!, id };
}

function groupIds(keys: string[]): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const key of keys) {
    const ref = parseKey(key);
    if (!ref) continue;
    const ids = grouped.get(ref.type) ?? [];
    ids.push(ref.id);
    grouped.set(ref.type, ids);
  }
  for (const [type, ids] of grouped) {
    grouped.set(type, [...new Set(ids)]);
  }
  return grouped;
}

function idsOf(grouped: Map<string, number[]>, type: string): number[] {
  return grouped.get(type) ?? [];
}

function otherEnd(source: string, target: string, frontier: Set<string>): string {
  if (frontier.has(source) && !frontier.has(target)) return target;
  if (frontier.has(target) && !frontier.has(source)) return source;
  return target;
}

function remember(edge: GraphEdge, frontier: Set<string>, into: Provisional[]): void {
  if (edge.source === edge.target) return;
  into.push({ edge, otherKey: otherEnd(edge.source, edge.target, frontier) });
}

export async function getGraphNeighbourhood(
  db: Db,
  actor: LinkActor,
  input: {
    rootType: string;
    rootId: number;
    depth: number;
    relations: ReadonlySet<string>;
    hideDone: boolean;
  },
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean }> {
  const root = graphNodeKey(input.rootType, input.rootId);
  const visible = new Set<string>([root]);
  let hitLimit = false;
  const fetchLimit = GRAPH_NODE_CAP + 1;

  const rootDone = await isTaskOrTodoDone(db, input.rootType, input.rootId);

  const walked = await walkNeighbourhood({
    root,
    depth: input.depth,
    cap: GRAPH_NODE_CAP,
    hideDone: input.hideDone,
    rootDone,
    relations: input.relations,
    isVisible: (key) => visible.has(key),
    expand: async (keys) => {
      const found = await collectEdges(db, keys, input.relations, fetchLimit, () => {
        hitLimit = true;
      });
      const kept = await dropDeletedEnds(db, found);
      await markVisible(db, actor, kept.map((item) => item.key), visible);
      return kept;
    },
  });

  const nodes = await hydrateNodes(db, walked.keys);
  const present = new Set(nodes.map((node) => node.key));
  const edges = walked.edges.filter(
    (edge) => present.has(edge.source) && present.has(edge.target),
  );
  return {
    nodes,
    edges,
    truncated: walked.truncated || hitLimit,
  };
}

async function isTaskOrTodoDone(db: Db, type: string, id: number): Promise<boolean> {
  if (type !== "task" && type !== "todo") return false;
  const table = type === "task" ? schema.tasks : schema.todos;
  const [row] = await db
    .select({ state: table.state })
    .from(table)
    .where(eq(table.id, id));
  return row != null && DONE_STATES.has(row.state);
}

async function markVisible(
  db: Db,
  actor: LinkActor,
  keys: string[],
  visible: Set<string>,
): Promise<void> {
  const entityRefs: { entityType: EntityType; id: number }[] = [];
  const tagIds: number[] = [];
  for (const key of keys) {
    const ref = parseKey(key);
    if (!ref) continue;
    if (ref.type === "tag") tagIds.push(ref.id);
    else if (isEntityType(ref.type)) entityRefs.push({ entityType: ref.type, id: ref.id });
  }
  if (entityRefs.length > 0) {
    const ends = await loadVisibleEnds(db, entityRefs, actor);
    for (const key of ends.keys()) visible.add(key);
  }
  if (tagIds.length === 0) return;
  const rows = await db
    .select({ id: schema.tags.id, ownerId: schema.tags.ownerId })
    .from(schema.tags)
    .where(inArray(schema.tags.id, [...new Set(tagIds)]));
  for (const row of rows) {
    if (actor.isAdministrator || row.ownerId === actor.userId) {
      visible.add(graphNodeKey("tag", row.id));
    }
  }
}

async function dropDeletedEnds(db: Db, neighbours: GraphNeighbour[]): Promise<GraphNeighbour[]> {
  const taskIds = new Set<number>();
  const todoIds = new Set<number>();
  for (const neighbour of neighbours) {
    for (const key of [neighbour.edge.source, neighbour.edge.target]) {
      const ref = parseKey(key);
      if (!ref) continue;
      if (ref.type === "task") taskIds.add(ref.id);
      if (ref.type === "todo") todoIds.add(ref.id);
    }
  }
  const taskState = await stateMap(db, "task", [...taskIds]);
  const todoState = await stateMap(db, "todo", [...todoIds]);

  const kept: GraphNeighbour[] = [];
  for (const neighbour of neighbours) {
    if (endDeleted(neighbour.edge.source, taskState, todoState)) continue;
    if (endDeleted(neighbour.edge.target, taskState, todoState)) continue;
    const ref = parseKey(neighbour.key);
    const done =
      ref?.type === "task"
        ? DONE_STATES.has(taskState.get(ref.id) ?? "")
        : ref?.type === "todo"
          ? DONE_STATES.has(todoState.get(ref.id) ?? "")
          : false;
    kept.push({ ...neighbour, done });
  }
  return kept;
}

function endDeleted(
  key: string,
  taskState: Map<number, string>,
  todoState: Map<number, string>,
): boolean {
  const ref = parseKey(key);
  if (!ref) return false;
  if (ref.type === "task") return taskState.get(ref.id) === "deleted" || !taskState.has(ref.id);
  if (ref.type === "todo") return todoState.get(ref.id) === "deleted" || !todoState.has(ref.id);
  return false;
}

async function stateMap(
  db: Db,
  type: "task" | "todo",
  ids: number[],
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (ids.length === 0) return map;
  const table = type === "task" ? schema.tasks : schema.todos;
  const rows = await db
    .select({ id: table.id, state: table.state })
    .from(table)
    .where(inArray(table.id, ids));
  for (const row of rows) map.set(row.id, row.state);
  return map;
}

async function collectEdges(
  db: Db,
  keys: string[],
  relations: ReadonlySet<string>,
  fetchLimit: number,
  onLimit: () => void,
): Promise<GraphNeighbour[]> {
  const frontier = new Set(keys);
  const grouped = groupIds(keys);
  const found: Provisional[] = [];
  const note = (rowsLength: number) => {
    if (rowsLength >= fetchLimit) onLimit();
  };

  if (relations.has("in_project")) {
    await collectInProject(db, grouped, frontier, found, fetchLimit, note);
  }
  if (relations.has("child_of")) {
    await collectChildOf(db, grouped, frontier, found, fetchLimit, note);
  }
  if (relations.has("depends_on")) {
    await collectDependsOn(db, grouped, frontier, found, fetchLimit, note);
  }
  if (relations.has("in_list")) {
    await collectInList(db, grouped, frontier, found, fetchLimit, note);
  }
  if (relations.has("on_board")) {
    await collectOnBoard(db, grouped, frontier, found, fetchLimit, note);
  }
  if (relations.has("in_wiki")) {
    await collectInWiki(db, grouped, frontier, found, fetchLimit, note);
  }
  if (relations.has("from_idea")) {
    await collectFromIdea(db, grouped, frontier, found, fetchLimit, note);
  }
  if (relations.has("tagged")) {
    await collectTagged(db, grouped, frontier, found, fetchLimit, note);
  }
  if (LINK_RELATIONS.some((relation) => relations.has(relation))) {
    await collectEntityLinks(db, grouped, relations, frontier, found, fetchLimit, note);
  }

  return found.map((item) => ({
    key: item.otherKey,
    done: false,
    edge: item.edge,
  }));
}

async function collectInProject(
  db: Db,
  grouped: Map<string, number[]>,
  frontier: Set<string>,
  found: Provisional[],
  fetchLimit: number,
  note: (n: number) => void,
): Promise<void> {
  const projectIds = idsOf(grouped, "project");

  const taskIds = idsOf(grouped, "task");
  if (projectIds.length > 0 || taskIds.length > 0) {
    const rows = await db
      .select({ id: schema.tasks.id, projectId: schema.tasks.projectId })
      .from(schema.tasks)
      .where(
        and(
          ne(schema.tasks.state, "deleted"),
          or(
            projectIds.length > 0 ? inArray(schema.tasks.projectId, projectIds) : undefined,
            taskIds.length > 0 ? inArray(schema.tasks.id, taskIds) : undefined,
          ),
        ),
      )
      .limit(fetchLimit);
    note(rows.length);
    for (const row of rows) {
      if (row.projectId == null) continue;
      remember(
        {
          source: graphNodeKey("project", row.projectId),
          target: graphNodeKey("task", row.id),
          relation: "in_project",
          origin: null,
        },
        frontier,
        found,
      );
    }
  }

  await membershipTable({
    projectIds,
    memberIds: idsOf(grouped, "todo"),
    type: "todo",
    fetchLimit,
    note,
    frontier,
    found,
    load: async (limit) =>
      db
        .select({ id: schema.todos.id, projectId: schema.todos.projectId })
        .from(schema.todos)
        .where(
          and(
            ne(schema.todos.state, "deleted"),
            or(
              projectIds.length > 0 ? inArray(schema.todos.projectId, projectIds) : undefined,
              idsOf(grouped, "todo").length > 0
                ? inArray(schema.todos.id, idsOf(grouped, "todo"))
                : undefined,
            ),
          ),
        )
        .limit(limit),
  });

  const plain: Array<{
    type: EntityType;
    memberIds: number[];
    load: (limit: number) => Promise<{ id: number; projectId: number | null }[]>;
  }> = [
    {
      type: "document",
      memberIds: idsOf(grouped, "document"),
      load: (limit) =>
        scopedProjectRows(
          db,
          schema.projectDocuments,
          schema.projectDocuments.id,
          schema.projectDocuments.projectId,
          projectIds,
          idsOf(grouped, "document"),
          limit,
        ),
    },
    {
      type: "todo_list",
      memberIds: idsOf(grouped, "todo_list"),
      load: (limit) =>
        scopedProjectRows(
          db,
          schema.todoLists,
          schema.todoLists.id,
          schema.todoLists.projectId,
          projectIds,
          idsOf(grouped, "todo_list"),
          limit,
        ),
    },
    {
      type: "board",
      memberIds: idsOf(grouped, "board"),
      load: (limit) =>
        scopedProjectRows(
          db,
          schema.boards,
          schema.boards.id,
          schema.boards.projectId,
          projectIds,
          idsOf(grouped, "board"),
          limit,
        ),
    },
    {
      type: "canvas",
      memberIds: idsOf(grouped, "canvas"),
      load: (limit) =>
        scopedProjectRows(
          db,
          schema.canvases,
          schema.canvases.id,
          schema.canvases.projectId,
          projectIds,
          idsOf(grouped, "canvas"),
          limit,
        ),
    },
    {
      type: "wiki_node",
      memberIds: idsOf(grouped, "wiki_node"),
      load: (limit) =>
        scopedProjectRows(
          db,
          schema.wikiNodes,
          schema.wikiNodes.id,
          schema.wikiNodes.projectId,
          projectIds,
          idsOf(grouped, "wiki_node"),
          limit,
        ),
    },
    {
      type: "image_board",
      memberIds: idsOf(grouped, "image_board"),
      load: (limit) =>
        scopedProjectRows(
          db,
          schema.imageBoards,
          schema.imageBoards.id,
          schema.imageBoards.projectId,
          projectIds,
          idsOf(grouped, "image_board"),
          limit,
        ),
    },
  ];

  for (const table of plain) {
    if (projectIds.length === 0 && table.memberIds.length === 0) continue;
    const rows = await table.load(fetchLimit);
    note(rows.length);
    for (const row of rows) {
      if (row.projectId == null) continue;
      remember(
        {
          source: graphNodeKey("project", row.projectId),
          target: graphNodeKey(table.type, row.id),
          relation: "in_project",
          origin: null,
        },
        frontier,
        found,
      );
    }
  }
}

async function scopedProjectRows(
  db: Db,
  table: PgTable,
  idCol: AnyPgColumn,
  projectCol: AnyPgColumn,
  projectIds: number[],
  memberIds: number[],
  limit: number,
): Promise<{ id: number; projectId: number | null }[]> {
  const rows = await db
    .select({ id: idCol, projectId: projectCol })
    .from(table)
    .where(
      or(
        projectIds.length > 0 ? inArray(projectCol, projectIds) : undefined,
        memberIds.length > 0 ? inArray(idCol, memberIds) : undefined,
      ),
    )
    .limit(limit);
  return rows as { id: number; projectId: number | null }[];
}

async function membershipTable(
  opts: {
    projectIds: number[];
    memberIds: number[];
    type: EntityType;
    fetchLimit: number;
    note: (n: number) => void;
    frontier: Set<string>;
    found: Provisional[];
    load: (limit: number) => Promise<{ id: number; projectId: number | null }[]>;
  },
): Promise<void> {
  if (opts.projectIds.length === 0 && opts.memberIds.length === 0) return;
  const rows = await opts.load(opts.fetchLimit);
  opts.note(rows.length);
  for (const row of rows) {
    if (row.projectId == null) continue;
    remember(
      {
        source: graphNodeKey("project", row.projectId),
        target: graphNodeKey(opts.type, row.id),
        relation: "in_project",
        origin: null,
      },
      opts.frontier,
      opts.found,
    );
  }
}

async function collectChildOf(
  db: Db,
  grouped: Map<string, number[]>,
  frontier: Set<string>,
  found: Provisional[],
  fetchLimit: number,
  note: (n: number) => void,
): Promise<void> {
  const taskIds = idsOf(grouped, "task");
  if (taskIds.length > 0) {
    const rows = await db
      .select({ id: schema.tasks.id, parentId: schema.tasks.parentId })
      .from(schema.tasks)
      .where(
        and(
          isNotNull(schema.tasks.parentId),
          ne(schema.tasks.state, "deleted"),
          or(inArray(schema.tasks.id, taskIds), inArray(schema.tasks.parentId, taskIds)),
        ),
      )
      .limit(fetchLimit);
    note(rows.length);
    for (const row of rows) {
      if (row.parentId == null) continue;
      remember(
        {
          source: graphNodeKey("task", row.id),
          target: graphNodeKey("task", row.parentId),
          relation: "child_of",
          origin: null,
        },
        frontier,
        found,
      );
    }
  }

  const todoIds = idsOf(grouped, "todo");
  if (todoIds.length === 0) return;
  const rows = await db
    .select({ id: schema.todos.id, parentId: schema.todos.parentId })
    .from(schema.todos)
    .where(
      and(
        isNotNull(schema.todos.parentId),
        ne(schema.todos.state, "deleted"),
        or(inArray(schema.todos.id, todoIds), inArray(schema.todos.parentId, todoIds)),
      ),
    )
    .limit(fetchLimit);
  note(rows.length);
  for (const row of rows) {
    if (row.parentId == null) continue;
    remember(
      {
        source: graphNodeKey("todo", row.id),
        target: graphNodeKey("todo", row.parentId),
        relation: "child_of",
        origin: null,
      },
      frontier,
      found,
    );
  }
}

async function collectDependsOn(
  db: Db,
  grouped: Map<string, number[]>,
  frontier: Set<string>,
  found: Provisional[],
  fetchLimit: number,
  note: (n: number) => void,
): Promise<void> {
  const taskIds = idsOf(grouped, "task");
  if (taskIds.length === 0) return;
  const rows = await db
    .select({
      taskId: schema.taskDependencies.taskId,
      dependsOnTaskId: schema.taskDependencies.dependsOnTaskId,
    })
    .from(schema.taskDependencies)
    .where(
      or(
        inArray(schema.taskDependencies.taskId, taskIds),
        inArray(schema.taskDependencies.dependsOnTaskId, taskIds),
      ),
    )
    .limit(fetchLimit);
  note(rows.length);
  for (const row of rows) {
    remember(
      {
        source: graphNodeKey("task", row.taskId),
        target: graphNodeKey("task", row.dependsOnTaskId),
        relation: "depends_on",
        origin: null,
      },
      frontier,
      found,
    );
  }
}

async function collectInList(
  db: Db,
  grouped: Map<string, number[]>,
  frontier: Set<string>,
  found: Provisional[],
  fetchLimit: number,
  note: (n: number) => void,
): Promise<void> {
  const listIds = idsOf(grouped, "todo_list");
  const memberClauses: SQL[] = [];
  for (const [type, ids] of grouped) {
    if (type === "todo_list" || ids.length === 0 || !isEntityType(type)) continue;
    memberClauses.push(
      and(eq(schema.todoListItems.entityType, type), inArray(schema.todoListItems.entityId, ids))!,
    );
  }
  if (listIds.length === 0 && memberClauses.length === 0) return;
  const rows = await db
    .select({
      listId: schema.todoListItems.listId,
      entityType: schema.todoListItems.entityType,
      entityId: schema.todoListItems.entityId,
    })
    .from(schema.todoListItems)
    .where(
      or(
        listIds.length > 0 ? inArray(schema.todoListItems.listId, listIds) : undefined,
        memberClauses.length > 0 ? or(...memberClauses) : undefined,
      ),
    )
    .limit(fetchLimit);
  note(rows.length);
  for (const row of rows) {
    if (!isEntityType(row.entityType)) continue;
    remember(
      {
        source: graphNodeKey("todo_list", row.listId),
        target: graphNodeKey(row.entityType, row.entityId),
        relation: "in_list",
        origin: null,
      },
      frontier,
      found,
    );
  }
}

async function collectOnBoard(
  db: Db,
  grouped: Map<string, number[]>,
  frontier: Set<string>,
  found: Provisional[],
  fetchLimit: number,
  note: (n: number) => void,
): Promise<void> {
  const boardIds = idsOf(grouped, "board");
  const memberClauses: SQL[] = [];
  for (const [type, ids] of grouped) {
    if (type === "board" || ids.length === 0 || !isEntityType(type)) continue;
    memberClauses.push(
      and(eq(schema.boardCards.entityType, type), inArray(schema.boardCards.entityId, ids))!,
    );
  }
  if (boardIds.length === 0 && memberClauses.length === 0) return;
  const rows = await db
    .select({
      boardId: schema.boardCards.boardId,
      entityType: schema.boardCards.entityType,
      entityId: schema.boardCards.entityId,
    })
    .from(schema.boardCards)
    .where(
      or(
        boardIds.length > 0 ? inArray(schema.boardCards.boardId, boardIds) : undefined,
        memberClauses.length > 0 ? or(...memberClauses) : undefined,
      ),
    )
    .limit(fetchLimit);
  note(rows.length);
  for (const row of rows) {
    if (!isEntityType(row.entityType)) continue;
    remember(
      {
        source: graphNodeKey("board", row.boardId),
        target: graphNodeKey(row.entityType, row.entityId),
        relation: "on_board",
        origin: null,
      },
      frontier,
      found,
    );
  }
}

async function collectInWiki(
  db: Db,
  grouped: Map<string, number[]>,
  frontier: Set<string>,
  found: Provisional[],
  fetchLimit: number,
  note: (n: number) => void,
): Promise<void> {
  const wikiIds = idsOf(grouped, "wiki_node");
  const memberClauses: SQL[] = [];
  for (const [type, ids] of grouped) {
    if (type === "wiki_node" || ids.length === 0 || !isEntityType(type)) continue;
    memberClauses.push(
      and(eq(schema.wikiNodes.entityType, type), inArray(schema.wikiNodes.entityId, ids))!,
    );
  }
  if (wikiIds.length === 0 && memberClauses.length === 0) return;
  const rows = await db
    .select({
      id: schema.wikiNodes.id,
      entityType: schema.wikiNodes.entityType,
      entityId: schema.wikiNodes.entityId,
    })
    .from(schema.wikiNodes)
    .where(
      or(
        wikiIds.length > 0 ? inArray(schema.wikiNodes.id, wikiIds) : undefined,
        memberClauses.length > 0 ? or(...memberClauses) : undefined,
      ),
    )
    .limit(fetchLimit);
  note(rows.length);
  for (const row of rows) {
    if (!isEntityType(row.entityType)) continue;
    remember(
      {
        source: graphNodeKey("wiki_node", row.id),
        target: graphNodeKey(row.entityType, row.entityId),
        relation: "in_wiki",
        origin: null,
      },
      frontier,
      found,
    );
  }
}

async function collectFromIdea(
  db: Db,
  grouped: Map<string, number[]>,
  frontier: Set<string>,
  found: Provisional[],
  fetchLimit: number,
  note: (n: number) => void,
): Promise<void> {
  const projectIds = idsOf(grouped, "project");
  const ideaIds = idsOf(grouped, "idea");
  if (projectIds.length > 0 || ideaIds.length > 0) {
    const rows = await db
      .select({ id: schema.projects.id, sourceIdeaId: schema.projects.sourceIdeaId })
      .from(schema.projects)
      .where(
        and(
          isNotNull(schema.projects.sourceIdeaId),
          or(
            projectIds.length > 0 ? inArray(schema.projects.id, projectIds) : undefined,
            ideaIds.length > 0 ? inArray(schema.projects.sourceIdeaId, ideaIds) : undefined,
          ),
        ),
      )
      .limit(fetchLimit);
    note(rows.length);
    for (const row of rows) {
      if (row.sourceIdeaId == null) continue;
      remember(
        {
          source: graphNodeKey("project", row.id),
          target: graphNodeKey("idea", row.sourceIdeaId),
          relation: "from_idea",
          origin: null,
        },
        frontier,
        found,
      );
    }
  }

  const todoIds = idsOf(grouped, "todo");
  if (todoIds.length === 0 && ideaIds.length === 0) return;
  const rows = await db
    .select({ id: schema.todos.id, sourceIdeaId: schema.todos.sourceIdeaId })
    .from(schema.todos)
    .where(
      and(
        isNotNull(schema.todos.sourceIdeaId),
        ne(schema.todos.state, "deleted"),
        or(
          todoIds.length > 0 ? inArray(schema.todos.id, todoIds) : undefined,
          ideaIds.length > 0 ? inArray(schema.todos.sourceIdeaId, ideaIds) : undefined,
        ),
      ),
    )
    .limit(fetchLimit);
  note(rows.length);
  for (const row of rows) {
    if (row.sourceIdeaId == null) continue;
    remember(
      {
        source: graphNodeKey("todo", row.id),
        target: graphNodeKey("idea", row.sourceIdeaId),
        relation: "from_idea",
        origin: null,
      },
      frontier,
      found,
    );
  }
}

async function collectTagged(
  db: Db,
  grouped: Map<string, number[]>,
  frontier: Set<string>,
  found: Provisional[],
  fetchLimit: number,
  note: (n: number) => void,
): Promise<void> {
  const tagIds = idsOf(grouped, "tag");
  const memberClauses: SQL[] = [];
  for (const [type, ids] of grouped) {
    if (type === "tag" || ids.length === 0 || !isEntityType(type)) continue;
    memberClauses.push(
      and(eq(schema.taggings.entityType, type), inArray(schema.taggings.entityId, ids))!,
    );
  }
  if (tagIds.length === 0 && memberClauses.length === 0) return;
  const rows = await db
    .select({
      tagId: schema.taggings.tagId,
      entityType: schema.taggings.entityType,
      entityId: schema.taggings.entityId,
    })
    .from(schema.taggings)
    .where(
      or(
        tagIds.length > 0 ? inArray(schema.taggings.tagId, tagIds) : undefined,
        memberClauses.length > 0 ? or(...memberClauses) : undefined,
      ),
    )
    .limit(fetchLimit);
  note(rows.length);
  for (const row of rows) {
    if (!isEntityType(row.entityType)) continue;
    remember(
      {
        source: graphNodeKey(row.entityType, row.entityId),
        target: graphNodeKey("tag", row.tagId),
        relation: "tagged",
        origin: null,
      },
      frontier,
      found,
    );
  }
}

async function collectEntityLinks(
  db: Db,
  grouped: Map<string, number[]>,
  relations: ReadonlySet<string>,
  frontier: Set<string>,
  found: Provisional[],
  fetchLimit: number,
  note: (n: number) => void,
): Promise<void> {
  const clauses: SQL[] = [];
  for (const [type, ids] of grouped) {
    if (ids.length === 0 || !isEntityType(type)) continue;
    clauses.push(and(eq(schema.entityLinks.srcType, type), inArray(schema.entityLinks.srcId, ids))!);
    clauses.push(and(eq(schema.entityLinks.dstType, type), inArray(schema.entityLinks.dstId, ids))!);
  }
  if (clauses.length === 0) return;
  const wanted = LINK_RELATIONS.filter((relation) => relations.has(relation));
  if (wanted.length === 0) return;
  const rows = await db
    .select({
      srcType: schema.entityLinks.srcType,
      srcId: schema.entityLinks.srcId,
      dstType: schema.entityLinks.dstType,
      dstId: schema.entityLinks.dstId,
      relation: schema.entityLinks.relation,
      origin: schema.entityLinks.origin,
    })
    .from(schema.entityLinks)
    .where(and(or(...clauses), inArray(schema.entityLinks.relation, wanted)))
    .limit(fetchLimit);
  note(rows.length);
  for (const row of rows) {
    if (!isEntityType(row.srcType) || !isEntityType(row.dstType)) continue;
    remember(
      {
        source: graphNodeKey(row.srcType, row.srcId),
        target: graphNodeKey(row.dstType, row.dstId),
        relation: row.relation,
        origin: row.origin,
      },
      frontier,
      found,
    );
  }
}

type NodeRow = {
  id: number;
  number: number;
  title: string;
  projectId: number | null;
  state: string | null;
  progress: number | null;
  priority: string | null;
  dueDate: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  signalAt: Date | null;
};

function iso(value: Date | null | undefined): string | null {
  if (value == null) return null;
  return value.toISOString();
}

function asRow(
  row: {
    id: number;
    number: number;
    title: string;
    projectId: number | null;
    state?: string | null;
    progress?: number | null;
    priority?: string | null;
    dueDate?: string | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
    signalAt?: Date | null;
  },
): NodeRow {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    projectId: row.projectId,
    state: row.state ?? null,
    progress: row.progress ?? null,
    priority: row.priority ?? null,
    dueDate: row.dueDate ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    signalAt: row.signalAt ?? row.updatedAt ?? null,
  };
}

async function taskSignalTimes(db: Db, taskIds: number[]): Promise<Map<number, Date>> {
  const times = new Map<number, Date>();
  if (taskIds.length === 0) return times;
  const rows = await db
    .select({
      taskId: schema.taskActivity.taskId,
      at: max(schema.taskActivity.createdAt),
    })
    .from(schema.taskActivity)
    .where(and(inArray(schema.taskActivity.taskId, taskIds), eq(schema.taskActivity.field, "state")))
    .groupBy(schema.taskActivity.taskId);
  for (const row of rows) {
    if (row.at) times.set(row.taskId, row.at);
  }
  return times;
}

async function hydrateNodes(db: Db, keys: string[]): Promise<GraphNode[]> {
  const grouped = groupIds(keys);
  const byKey = new Map<string, GraphNode>();

  const load = async (type: EntityType, rows: NodeRow[]) => {
    for (const row of rows) {
      const key = graphNodeKey(type, row.id);
      byKey.set(key, {
        key,
        type,
        id: row.id,
        referenceId: formatEntityRef(type, row.number),
        title: row.title,
        state: row.state,
        progress: row.progress,
        priority: row.priority,
        dueDate: row.dueDate,
        createdAt: iso(row.createdAt),
        signalAt: iso(row.signalAt),
        projectId: row.projectId,
        href: hrefFor(type, row.id, row.projectId),
      });
    }
  };

  const ideaIds = idsOf(grouped, "idea");
  if (ideaIds.length > 0) {
    const rows = await db
      .select({
        id: schema.ideas.id,
        number: schema.ideas.number,
        title: schema.ideas.title,
        createdAt: schema.ideas.createdAt,
        updatedAt: schema.ideas.updatedAt,
      })
      .from(schema.ideas)
      .where(inArray(schema.ideas.id, ideaIds));
    await load(
      "idea",
      rows.map((row) => asRow({ ...row, projectId: null })),
    );
  }

  const projectIds = idsOf(grouped, "project");
  if (projectIds.length > 0) {
    const rows = await db
      .select({
        id: schema.projects.id,
        number: schema.projects.number,
        title: schema.projects.name,
        state: schema.projects.status,
        createdAt: schema.projects.createdAt,
        updatedAt: schema.projects.updatedAt,
      })
      .from(schema.projects)
      .where(inArray(schema.projects.id, projectIds));
    await load(
      "project",
      rows.map((row) => asRow({ ...row, projectId: row.id })),
    );
  }

  const taskIds = idsOf(grouped, "task");
  if (taskIds.length > 0) {
    const rows = await db
      .select({
        id: schema.tasks.id,
        number: schema.tasks.number,
        title: schema.tasks.title,
        projectId: schema.tasks.projectId,
        state: schema.tasks.state,
        priority: schema.tasks.priority,
        dueDate: schema.tasks.dueDate,
        createdAt: schema.tasks.createdAt,
        updatedAt: schema.tasks.updatedAt,
      })
      .from(schema.tasks)
      .where(and(inArray(schema.tasks.id, taskIds), ne(schema.tasks.state, "deleted")));
    const signals = await taskSignalTimes(db, taskIds);
    await load(
      "task",
      rows.map((row) => asRow({ ...row, signalAt: signals.get(row.id) ?? row.updatedAt })),
    );
  }

  const todoIds = idsOf(grouped, "todo");
  if (todoIds.length > 0) {
    const rows = await db
      .select({
        id: schema.todos.id,
        number: schema.todos.number,
        title: schema.todos.title,
        projectId: schema.todos.projectId,
        state: schema.todos.state,
        progress: schema.todos.progress,
        priority: schema.todos.priority,
        dueDate: schema.todos.dueDate,
        createdAt: schema.todos.createdAt,
        updatedAt: schema.todos.updatedAt,
      })
      .from(schema.todos)
      .where(and(inArray(schema.todos.id, todoIds), ne(schema.todos.state, "deleted")));
    await load(
      "todo",
      rows.map((row) => asRow(row)),
    );
  }

  await loadPlain(db, "document", idsOf(grouped, "document"), schema.projectDocuments, load);
  await loadPlain(db, "todo_list", idsOf(grouped, "todo_list"), schema.todoLists, load);
  await loadNamed(db, "board", idsOf(grouped, "board"), load);
  await loadPlain(db, "canvas", idsOf(grouped, "canvas"), schema.canvases, load);
  await loadPlain(db, "wiki_node", idsOf(grouped, "wiki_node"), schema.wikiNodes, load);
  await loadPlain(db, "image_board", idsOf(grouped, "image_board"), schema.imageBoards, load);

  const tagIds = idsOf(grouped, "tag");
  if (tagIds.length > 0) {
    const rows = await db
      .select({ id: schema.tags.id, title: schema.tags.name })
      .from(schema.tags)
      .where(inArray(schema.tags.id, tagIds));
    for (const row of rows) {
      const key = graphNodeKey("tag", row.id);
      byKey.set(key, {
        key,
        type: "tag",
        id: row.id,
        referenceId: null,
        title: row.title,
        state: null,
        progress: null,
        priority: null,
        dueDate: null,
        createdAt: null,
        signalAt: null,
        projectId: null,
        href: null,
      });
    }
  }

  return keys.flatMap((key) => {
    const node = byKey.get(key);
    return node ? [node] : [];
  });
}

async function loadPlain(
  db: Db,
  type: EntityType,
  ids: number[],
  table:
    | typeof schema.projectDocuments
    | typeof schema.todoLists
    | typeof schema.canvases
    | typeof schema.wikiNodes
    | typeof schema.imageBoards,
  load: (type: EntityType, rows: NodeRow[]) => Promise<void>,
): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select({
      id: table.id,
      number: table.number,
      title: table.title,
      projectId: table.projectId,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    })
    .from(table)
    .where(inArray(table.id, ids));
  await load(
    type,
    rows.map((row) => asRow(row)),
  );
}

async function loadNamed(
  db: Db,
  type: EntityType,
  ids: number[],
  load: (type: EntityType, rows: NodeRow[]) => Promise<void>,
): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select({
      id: schema.boards.id,
      number: schema.boards.number,
      title: schema.boards.name,
      projectId: schema.boards.projectId,
      createdAt: schema.boards.createdAt,
      updatedAt: schema.boards.updatedAt,
    })
    .from(schema.boards)
    .where(inArray(schema.boards.id, ids));
  await load(
    type,
    rows.map((row) => asRow(row)),
  );
}
