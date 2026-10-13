import { and, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import type { EntityType } from "../../lib/entityType.js";
import { getAiProjectAccessCeiling } from "../assistant/projectAiAccess.js";
import {
  dualScopeListFilter,
  ownerScope,
  projectAccessListFilter,
  projectOwnedListFilter,
} from "../ownership.js";
import { embedTexts } from "./embed.js";
import { reciprocalRankFusion } from "./fusion.js";
import { toSimpleTsQuery } from "./queryText.js";

const CANDIDATES = 40;

export type KnowledgeHit = {
  id: number;
  entityType: EntityType;
  entityId: number;
  projectId: number | null;
  content: string;
  heading: string | null;
  locator: number | null;
  startOffset: number;
  endOffset: number;
  score: number;
};

export async function knowledgeEntityIds(entityType: EntityType, rawQuery: string): Promise<number[]> {
  const ts = toSimpleTsQuery(rawQuery);
  if (!ts) return [];
  const result = await db.execute<{ entity_id: number }>(sql`
    SELECT entity_id
    FROM knowledge_chunks
    WHERE entity_type = ${entityType}
      AND content_tsv @@ to_tsquery('simple', ${ts})
    GROUP BY entity_id
    ORDER BY max(ts_rank(content_tsv, to_tsquery('simple', ${ts}))) DESC
    LIMIT 200
  `);
  return result.rows.map((row) => row.entity_id);
}

export async function searchKnowledge(args: {
  actorId: number;
  isAdmin: boolean;
  q: string;
  projectId?: number;
  entityTypes?: EntityType[];
  limit: number;
}): Promise<KnowledgeHit[]> {
  const ts = toSimpleTsQuery(args.q);
  if (!ts) return [];
  const filter = await chunkFilter(args);
  const keyword = await keywordHits(ts, filter);
  const semantic = await semanticHits(args.q, filter);
  const fused = reciprocalRankFusion([
    keyword.map((row) => String(row.id)),
    semantic.map((row) => String(row.id)),
  ]);
  const byId = new Map<number, Omit<KnowledgeHit, "score">>();
  for (const row of [...keyword, ...semantic]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return fused.slice(0, args.limit).flatMap((item) => {
    const row = byId.get(Number(item.id));
    if (!row) return [];
    return [{ ...row, score: item.score }];
  });
}

type ChunkRow = {
  id: number;
  entity_type: EntityType;
  entity_id: number;
  project_id: number | null;
  content: string;
  heading: string | null;
  locator: number | null;
  start_offset: number;
  end_offset: number;
};

async function keywordHits(ts: string, filter: SQL): Promise<Array<Omit<KnowledgeHit, "score">>> {
  const result = await db.execute<ChunkRow>(sql`
    SELECT id, entity_type, entity_id, project_id, content, heading, locator, start_offset, end_offset
    FROM knowledge_chunks
    WHERE content_tsv @@ to_tsquery('simple', ${ts})
      AND ${filter}
    ORDER BY ts_rank(content_tsv, to_tsquery('simple', ${ts})) DESC
    LIMIT ${CANDIDATES}
  `);
  return result.rows.map(toHit);
}

async function semanticHits(q: string, filter: SQL): Promise<Array<Omit<KnowledgeHit, "score">>> {
  const embedded = await embedTexts([q]);
  const vector = embedded?.vectors?.[0];
  if (!vector) return [];
  const literal = `[${vector.join(",")}]`;
  const result = await db.execute<ChunkRow>(sql`
    SELECT id, entity_type, entity_id, project_id, content, heading, locator, start_offset, end_offset
    FROM knowledge_chunks
    WHERE embedding IS NOT NULL
      AND ${filter}
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${CANDIDATES}
  `);
  return result.rows.map(toHit);
}

function toHit(row: ChunkRow): Omit<KnowledgeHit, "score"> {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    projectId: row.project_id,
    content: row.content,
    heading: row.heading,
    locator: row.locator,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
  };
}

async function chunkFilter(args: {
  actorId: number;
  isAdmin: boolean;
  projectId?: number;
  entityTypes?: EntityType[];
}): Promise<SQL> {
  const ceiling = await getAiProjectAccessCeiling(db);
  const parts: SQL[] = [visibilityFilter(args.actorId, args.isAdmin), excludedFilter(ceiling)];
  if (args.projectId != null) parts.push(eq(schema.knowledgeChunks.projectId, args.projectId));
  if (args.entityTypes && args.entityTypes.length > 0) {
    parts.push(inArray(schema.knowledgeChunks.entityType, args.entityTypes));
  }
  return and(...parts) ?? sql`true`;
}

function excludedFilter(ceiling: string): SQL {
  return sql`(
    ${schema.knowledgeChunks.projectId} IS NULL
    OR (
      ${ceiling} <> 'excluded'
      AND ${schema.knowledgeChunks.projectId} NOT IN (
        SELECT id FROM projects WHERE ai_access = 'excluded'
      )
    )
  )`;
}

function visibilityFilter(actorId: number, isAdmin: boolean): SQL {
  const ideaScope = ownerScope(schema.ideas.ownerId, actorId, isAdmin) ?? sql`true`;
  const projectScope = projectAccessListFilter(db, actorId, isAdmin) ?? sql`true`;
  const taskScope =
    dualScopeListFilter(db, schema.tasks.projectId, schema.tasks.ownerId, actorId, isAdmin) ?? sql`true`;
  const todoScope =
    dualScopeListFilter(db, schema.todos.projectId, schema.todos.ownerId, actorId, isAdmin) ?? sql`true`;
  const listScope =
    dualScopeListFilter(db, schema.todoLists.projectId, schema.todoLists.ownerId, actorId, isAdmin) ??
    sql`true`;
  const imageScope =
    dualScopeListFilter(
      db,
      schema.imageBoards.projectId,
      schema.imageBoards.ownerId,
      actorId,
      isAdmin,
    ) ?? sql`true`;
  const documentScope =
    projectOwnedListFilter(db, schema.projectDocuments.projectId, actorId, isAdmin) ?? sql`true`;
  const boardScope = projectOwnedListFilter(db, schema.boards.projectId, actorId, isAdmin) ?? sql`true`;
  const canvasScope = projectOwnedListFilter(db, schema.canvases.projectId, actorId, isAdmin) ?? sql`true`;
  const wikiScope = projectOwnedListFilter(db, schema.wikiNodes.projectId, actorId, isAdmin) ?? sql`true`;

  return (
    or(
      and(
        eq(schema.knowledgeChunks.entityType, "idea"),
        inArray(
          schema.knowledgeChunks.entityId,
          db.select({ id: schema.ideas.id }).from(schema.ideas).where(ideaScope),
        ),
      ),
      and(
        eq(schema.knowledgeChunks.entityType, "project"),
        inArray(
          schema.knowledgeChunks.entityId,
          db.select({ id: schema.projects.id }).from(schema.projects).where(projectScope),
        ),
      ),
      and(
        eq(schema.knowledgeChunks.entityType, "task"),
        inArray(
          schema.knowledgeChunks.entityId,
          db
            .select({ id: schema.tasks.id })
            .from(schema.tasks)
            .where(and(ne(schema.tasks.state, "deleted"), taskScope)),
        ),
      ),
      and(
        eq(schema.knowledgeChunks.entityType, "todo"),
        inArray(
          schema.knowledgeChunks.entityId,
          db
            .select({ id: schema.todos.id })
            .from(schema.todos)
            .where(and(ne(schema.todos.state, "deleted"), todoScope)),
        ),
      ),
      and(
        eq(schema.knowledgeChunks.entityType, "document"),
        inArray(
          schema.knowledgeChunks.entityId,
          db.select({ id: schema.projectDocuments.id }).from(schema.projectDocuments).where(documentScope),
        ),
      ),
      and(
        eq(schema.knowledgeChunks.entityType, "todo_list"),
        inArray(
          schema.knowledgeChunks.entityId,
          db.select({ id: schema.todoLists.id }).from(schema.todoLists).where(listScope),
        ),
      ),
      and(
        eq(schema.knowledgeChunks.entityType, "board"),
        inArray(
          schema.knowledgeChunks.entityId,
          db.select({ id: schema.boards.id }).from(schema.boards).where(boardScope),
        ),
      ),
      and(
        eq(schema.knowledgeChunks.entityType, "canvas"),
        inArray(
          schema.knowledgeChunks.entityId,
          db.select({ id: schema.canvases.id }).from(schema.canvases).where(canvasScope),
        ),
      ),
      and(
        eq(schema.knowledgeChunks.entityType, "wiki_node"),
        inArray(
          schema.knowledgeChunks.entityId,
          db.select({ id: schema.wikiNodes.id }).from(schema.wikiNodes).where(wikiScope),
        ),
      ),
      and(
        eq(schema.knowledgeChunks.entityType, "image_board"),
        inArray(
          schema.knowledgeChunks.entityId,
          db.select({ id: schema.imageBoards.id }).from(schema.imageBoards).where(imageScope),
        ),
      ),
    ) ?? sql`false`
  );
}
