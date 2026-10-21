import { and, eq, inArray, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { extractMentionTokens } from "../lib/mentionTokens.js";
import type { EntityType } from "../lib/entityType.js";
import { NotFoundError } from "../lib/notFound.js";
import { assertCanAccessEntity, OwnershipAccessError } from "./ownership.js";
import { reportMentions } from "./notifications/events.js";

type Db = NodePgDatabase<typeof schema>;

export type MentionSyncResult = {
  added: number;
  removed: number;
};

type End = { entityType: EntityType; id: number };

function endKey(end: End): string {
  return `${end.entityType}:${end.id}`;
}

async function idForDisplayNumber(
  db: Db,
  entityType: EntityType,
  number: number,
): Promise<number | null> {
  switch (entityType) {
    case "idea": {
      const [row] = await db
        .select({ id: schema.ideas.id })
        .from(schema.ideas)
        .where(eq(schema.ideas.number, number));
      return row?.id ?? null;
    }
    case "project": {
      const [row] = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.number, number));
      return row?.id ?? null;
    }
    case "task": {
      const [row] = await db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.number, number), ne(schema.tasks.state, "deleted")));
      return row?.id ?? null;
    }
    case "todo": {
      const [row] = await db
        .select({ id: schema.todos.id })
        .from(schema.todos)
        .where(and(eq(schema.todos.number, number), ne(schema.todos.state, "deleted")));
      return row?.id ?? null;
    }
    case "document": {
      const [row] = await db
        .select({ id: schema.projectDocuments.id })
        .from(schema.projectDocuments)
        .where(eq(schema.projectDocuments.number, number));
      return row?.id ?? null;
    }
    case "todo_list": {
      const [row] = await db
        .select({ id: schema.todoLists.id })
        .from(schema.todoLists)
        .where(eq(schema.todoLists.number, number));
      return row?.id ?? null;
    }
    case "board": {
      const [row] = await db
        .select({ id: schema.boards.id })
        .from(schema.boards)
        .where(eq(schema.boards.number, number));
      return row?.id ?? null;
    }
    case "canvas": {
      const [row] = await db
        .select({ id: schema.canvases.id })
        .from(schema.canvases)
        .where(eq(schema.canvases.number, number));
      return row?.id ?? null;
    }
    case "wiki_node": {
      const [row] = await db
        .select({ id: schema.wikiNodes.id })
        .from(schema.wikiNodes)
        .where(eq(schema.wikiNodes.number, number));
      return row?.id ?? null;
    }
    case "image_board": {
      const [row] = await db
        .select({ id: schema.imageBoards.id })
        .from(schema.imageBoards)
        .where(eq(schema.imageBoards.number, number));
      return row?.id ?? null;
    }
    case "plan": {
      const [row] = await db
        .select({ id: schema.plans.id })
        .from(schema.plans)
        .where(eq(schema.plans.number, number));
      return row?.id ?? null;
    }
    default: {
      const _exhaustive: never = entityType;
      return _exhaustive;
    }
  }
}

async function authorCanRead(db: Db, actorUserId: number, end: End): Promise<boolean> {
  try {
    await assertCanAccessEntity(db, actorUserId, end.entityType, end.id, "read");
    return true;
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof OwnershipAccessError) return false;
    throw err;
  }
}

/**
 * Store `references` links with origin `mention` for the tokens in `markdown`.
 * Mention rows this text no longer justifies are removed. Manual links stay.
 */
export async function syncMentionLinks(
  db: Db,
  input: {
    srcType: EntityType;
    srcId: number;
    markdown: string | null;
    actorUserId: number;
    dryRun?: boolean;
  },
): Promise<MentionSyncResult> {
  const desired = new Map<string, End>();
  for (const token of extractMentionTokens(input.markdown ?? "")) {
    const id = await idForDisplayNumber(db, token.entityType, token.number);
    if (id == null) continue;
    if (token.entityType === input.srcType && id === input.srcId) continue;
    const end = { entityType: token.entityType, id };
    if (!(await authorCanRead(db, input.actorUserId, end))) continue;
    desired.set(endKey(end), end);
  }

  const existing = await db
    .select({
      id: schema.entityLinks.id,
      dstType: schema.entityLinks.dstType,
      dstId: schema.entityLinks.dstId,
    })
    .from(schema.entityLinks)
    .where(
      and(
        eq(schema.entityLinks.srcType, input.srcType),
        eq(schema.entityLinks.srcId, input.srcId),
        eq(schema.entityLinks.relation, "references"),
        eq(schema.entityLinks.origin, "mention"),
      ),
    );

  const removeIds = existing
    .filter((row) => !desired.has(`${row.dstType}:${row.dstId}`))
    .map((row) => row.id);
  const have = new Set(existing.map((row) => `${row.dstType}:${row.dstId}`));
  const add = [...desired.values()].filter((end) => !have.has(endKey(end)));

  if (!input.dryRun) {
    if (removeIds.length > 0) {
      await db.delete(schema.entityLinks).where(inArray(schema.entityLinks.id, removeIds));
    }
    for (const end of add) {
      await db
        .insert(schema.entityLinks)
        .values({
          srcType: input.srcType,
          srcId: input.srcId,
          dstType: end.entityType,
          dstId: end.id,
          relation: "references",
          origin: "mention",
          createdById: input.actorUserId,
        })
        .onConflictDoNothing({
          target: [
            schema.entityLinks.srcType,
            schema.entityLinks.srcId,
            schema.entityLinks.dstType,
            schema.entityLinks.dstId,
            schema.entityLinks.relation,
            schema.entityLinks.origin,
          ],
        });
    }
    reportMentions(db, {
      actorUserId: input.actorUserId,
      srcType: input.srcType,
      srcId: input.srcId,
      targets: add,
    });
  }

  return { added: add.length, removed: removeIds.length };
}
