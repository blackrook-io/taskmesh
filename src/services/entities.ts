import { eq } from "drizzle-orm";
import type { db as DbType } from "../db/client.js";
import * as schema from "../db/schema.js";
import type { EntityType } from "../lib/entityType.js";

type Db = typeof DbType;

/** Entity types that currently support tagging / search. */
export const TAGGABLE_ENTITY_TYPES = ["idea", "project", "task", "document"] as const;
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
    case "document": {
      const [row] = await database
        .select({ id: schema.projectDocuments.id })
        .from(schema.projectDocuments)
        .where(eq(schema.projectDocuments.id, entityId));
      return Boolean(row);
    }
    case "image_board": {
      const [row] = await database
        .select({ id: schema.imageBoards.id })
        .from(schema.imageBoards)
        .where(eq(schema.imageBoards.id, entityId));
      return Boolean(row);
    }
    default:
      return false;
  }
}
