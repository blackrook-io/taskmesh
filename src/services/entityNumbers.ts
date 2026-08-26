import { max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type { EntityType } from "../lib/entityType.js";

type Db = NodePgDatabase<typeof schema>;

type NumberTable =
  | typeof schema.ideas
  | typeof schema.projects
  | typeof schema.projectDocuments
  | typeof schema.todos
  | typeof schema.todoLists
  | typeof schema.boards
  | typeof schema.canvases
  | typeof schema.wikiNodes
  | typeof schema.imageBoards
  | typeof schema.tasks;

const TABLE_BY_TYPE = {
  idea: () => schema.ideas,
  project: () => schema.projects,
  document: () => schema.projectDocuments,
  todo: () => schema.todos,
  todo_list: () => schema.todoLists,
  board: () => schema.boards,
  canvas: () => schema.canvases,
  wiki_node: () => schema.wikiNodes,
  image_board: () => schema.imageBoards,
  task: () => schema.tasks,
} as const satisfies Partial<Record<EntityType, () => NumberTable>>;

export async function allocateEntityNumber(
  db: Db,
  entityType: Exclude<EntityType, never>,
): Promise<number> {
  if (entityType === "task") {
    const [row] = await db.select({ m: max(schema.tasks.number) }).from(schema.tasks);
    return (row?.m ?? 0) + 1;
  }
  if (entityType === "todo") {
    const [row] = await db.select({ m: max(schema.todos.number) }).from(schema.todos);
    return (row?.m ?? 0) + 1;
  }
  const tableFn = TABLE_BY_TYPE[entityType as keyof typeof TABLE_BY_TYPE];
  if (!tableFn) {
    throw new Error(`No display number for entity type: ${entityType}`);
  }
  const table = tableFn();
  const [row] = await db.select({ m: max(table.number) }).from(table);
  return (row?.m ?? 0) + 1;
}

export async function allocateIdeaNumber(db: Db): Promise<number> {
  return allocateEntityNumber(db, "idea");
}
export async function allocateProjectNumber(db: Db): Promise<number> {
  return allocateEntityNumber(db, "project");
}
export async function allocateDocumentNumber(db: Db): Promise<number> {
  return allocateEntityNumber(db, "document");
}
export async function allocateTodoNumber(db: Db): Promise<number> {
  return allocateEntityNumber(db, "todo");
}
export async function allocateTodoListNumber(db: Db): Promise<number> {
  return allocateEntityNumber(db, "todo_list");
}
export async function allocateBoardNumber(db: Db): Promise<number> {
  return allocateEntityNumber(db, "board");
}
export async function allocateCanvasNumber(db: Db): Promise<number> {
  return allocateEntityNumber(db, "canvas");
}
export async function allocateWikiNodeNumber(db: Db): Promise<number> {
  return allocateEntityNumber(db, "wiki_node");
}
export async function allocateImageBoardNumber(db: Db): Promise<number> {
  return allocateEntityNumber(db, "image_board");
}
