import { eq } from "drizzle-orm";
import type { db as DbType } from "../db/client.js";
import * as schema from "../db/schema.js";
import type { EntityType } from "../lib/entityType.js";

type Db = typeof DbType;

/** Entity types that currently support tagging / search. */
export const TAGGABLE_ENTITY_TYPES = ["idea", "project", "task", "todo", "document"] as const;
export type TaggableEntityType = (typeof TAGGABLE_ENTITY_TYPES)[number];

export function isTaggableEntityType(value: string): value is TaggableEntityType {
  return (TAGGABLE_ENTITY_TYPES as readonly string[]).includes(value);
}

export async function entityExists(
  database: Db,
  entityType: EntityType,
  entityId: number,
): Promise<boolean> {
  switch (entityType) {
    case "idea": {
      const [row] = await database
        .select({ id: schema.ideas.id })
        .from(schema.ideas)
        .where(eq(schema.ideas.id, entityId));
      return Boolean(row);
    }
    case "project": {
      const [row] = await database
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.id, entityId));
      return Boolean(row);
    }
    case "task": {
      const [row] = await database
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, entityId));
      return Boolean(row);
    }
    case "todo": {
      const [row] = await database
        .select({ id: schema.todos.id })
        .from(schema.todos)
        .where(eq(schema.todos.id, entityId));
      return Boolean(row);
    }
    case "document": {
      const [row] = await database
        .select({ id: schema.projectDocuments.id })
        .from(schema.projectDocuments)
        .where(eq(schema.projectDocuments.id, entityId));
      return Boolean(row);
    }
    case "todo_list": {
      const [row] = await database
        .select({ id: schema.todoLists.id })
        .from(schema.todoLists)
        .where(eq(schema.todoLists.id, entityId));
      return Boolean(row);
    }
    case "board": {
      const [row] = await database
        .select({ id: schema.boards.id })
        .from(schema.boards)
        .where(eq(schema.boards.id, entityId));
      return Boolean(row);
    }
    case "canvas": {
      const [row] = await database
        .select({ id: schema.canvases.id })
        .from(schema.canvases)
        .where(eq(schema.canvases.id, entityId));
      return Boolean(row);
    }
    case "wiki_node": {
      const [row] = await database
        .select({ id: schema.wikiNodes.id })
        .from(schema.wikiNodes)
        .where(eq(schema.wikiNodes.id, entityId));
      return Boolean(row);
    }
    case "image_board": {
      const [row] = await database
        .select({ id: schema.imageBoards.id })
        .from(schema.imageBoards)
        .where(eq(schema.imageBoards.id, entityId));
      return Boolean(row);
    }
    case "plan": {
      const [row] = await database
        .select({ id: schema.plans.id })
        .from(schema.plans)
        .where(eq(schema.plans.id, entityId));
      return Boolean(row);
    }
    default: {
      const _exhaustive: never = entityType;
      return Boolean(_exhaustive);
    }
  }
}
