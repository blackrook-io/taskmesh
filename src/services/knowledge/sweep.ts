import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import type { EntityType } from "../../lib/entityType.js";
import { getAiProjectAccessCeiling } from "../assistant/projectAiAccess.js";
import { KNOWLEDGE_ENTITY_ORDER } from "./cursor.js";
import { scheduleKnowledgeIndex } from "./schedule.js";

const SWEEP_LIMIT = 80;

/** Drop orphans, clear embeddings on excluded projects, and enqueue records that are behind. */
export async function sweepKnowledgeIndex(): Promise<void> {
  await deleteOrphans();
  await clearExcludedEmbeddings();
  for (const entityType of KNOWLEDGE_ENTITY_ORDER) {
    const ids = await staleIds(entityType);
    for (const id of ids) await scheduleKnowledgeIndex(entityType, id);
  }
  const unembedded = await missingEmbeddingIds();
  for (const row of unembedded) await scheduleKnowledgeIndex(row.entityType, row.entityId);
  const commentParents = await commentParentsToIndex();
  for (const row of commentParents) await scheduleKnowledgeIndex(row.entityType, row.entityId);
  const documents = await documentsWithFreshExtraction();
  for (const id of documents) await scheduleKnowledgeIndex("document", id);
}

async function deleteOrphans(): Promise<void> {
  await db.execute(sql`
    DELETE FROM knowledge_chunks c
    WHERE c.entity_type = 'idea'
      AND NOT EXISTS (SELECT 1 FROM ideas s WHERE s.id = c.entity_id)
  `);
  await db.execute(sql`
    DELETE FROM knowledge_chunks c
    WHERE c.entity_type = 'project'
      AND NOT EXISTS (SELECT 1 FROM projects s WHERE s.id = c.entity_id)
  `);
  await db.execute(sql`
    DELETE FROM knowledge_chunks c
    WHERE c.entity_type = 'task'
      AND NOT EXISTS (SELECT 1 FROM tasks s WHERE s.id = c.entity_id AND s.state <> 'deleted')
  `);
  await db.execute(sql`
    DELETE FROM knowledge_chunks c
    WHERE c.entity_type = 'todo'
      AND NOT EXISTS (SELECT 1 FROM todos s WHERE s.id = c.entity_id AND s.state <> 'deleted')
  `);
  await db.execute(sql`
    DELETE FROM knowledge_chunks c
    WHERE c.entity_type = 'document'
      AND NOT EXISTS (SELECT 1 FROM project_documents s WHERE s.id = c.entity_id)
  `);
  await db.execute(sql`
    DELETE FROM knowledge_chunks c
    WHERE c.entity_type = 'todo_list'
      AND NOT EXISTS (SELECT 1 FROM todo_lists s WHERE s.id = c.entity_id)
  `);
  await db.execute(sql`
    DELETE FROM knowledge_chunks c
    WHERE c.entity_type = 'board'
      AND NOT EXISTS (SELECT 1 FROM boards s WHERE s.id = c.entity_id)
  `);
  await db.execute(sql`
    DELETE FROM knowledge_chunks c
    WHERE c.entity_type = 'canvas'
      AND NOT EXISTS (SELECT 1 FROM canvases s WHERE s.id = c.entity_id)
  `);
  await db.execute(sql`
    DELETE FROM knowledge_chunks c
    WHERE c.entity_type = 'wiki_node'
      AND NOT EXISTS (SELECT 1 FROM wiki_nodes s WHERE s.id = c.entity_id)
  `);
  await db.execute(sql`
    DELETE FROM knowledge_chunks c
    WHERE c.entity_type = 'image_board'
      AND NOT EXISTS (SELECT 1 FROM image_boards s WHERE s.id = c.entity_id)
  `);
  await db.execute(sql`
    DELETE FROM knowledge_chunks c
    WHERE c.source = 'comment'
      AND NOT EXISTS (
        SELECT 1 FROM task_activity a
        WHERE a.id = c.source_id AND a.kind = 'comment'
      )
  `);
  await db.execute(sql`
    DELETE FROM knowledge_chunks c
    WHERE c.source = 'extraction'
      AND NOT EXISTS (SELECT 1 FROM document_text_spans s WHERE s.id = c.source_id)
  `);
}

async function clearExcludedEmbeddings(): Promise<void> {
  const ceiling = await getAiProjectAccessCeiling(db);
  if (ceiling === "excluded") {
    await db.execute(sql`
      UPDATE knowledge_chunks
      SET embedding = NULL, embedding_model = NULL
      WHERE project_id IS NOT NULL AND embedding IS NOT NULL
    `);
    return;
  }
  await db.execute(sql`
    UPDATE knowledge_chunks
    SET embedding = NULL, embedding_model = NULL
    WHERE embedding IS NOT NULL
      AND project_id IN (SELECT id FROM projects WHERE ai_access = 'excluded')
  `);
}

async function staleIds(entityType: EntityType): Promise<number[]> {
  const result = await db.execute<{ id: number }>(sql`
    SELECT s.id
    FROM ${sql.raw(sourceTable(entityType))} s
    LEFT JOIN (
      SELECT entity_id, max(updated_at) AS indexed_at
      FROM knowledge_chunks
      WHERE entity_type = ${entityType}
      GROUP BY entity_id
    ) k ON k.entity_id = s.id
    WHERE s.id > 0
      AND ${aliveSql(entityType)}
      AND (k.indexed_at IS NULL OR s.updated_at > k.indexed_at)
    ORDER BY s.id
    LIMIT ${SWEEP_LIMIT}
  `);
  return result.rows.map((row) => row.id);
}

async function missingEmbeddingIds(): Promise<Array<{ entityType: EntityType; entityId: number }>> {
  const ceiling = await getAiProjectAccessCeiling(db);
  const result = await db.execute<{ entity_type: EntityType; entity_id: number }>(sql`
    SELECT DISTINCT c.entity_type, c.entity_id
    FROM knowledge_chunks c
    WHERE c.embedding IS NULL
      AND (
        c.project_id IS NULL
        OR (
          ${ceiling} <> 'excluded'
          AND c.project_id NOT IN (SELECT id FROM projects WHERE ai_access = 'excluded')
        )
      )
    ORDER BY c.entity_type, c.entity_id
    LIMIT ${SWEEP_LIMIT}
  `);
  return result.rows.map((row) => ({ entityType: row.entity_type, entityId: row.entity_id }));
}

async function commentParentsToIndex(): Promise<Array<{ entityType: EntityType; entityId: number }>> {
  const result = await db.execute<{ entity_type: EntityType; entity_id: number }>(sql`
    SELECT DISTINCT a.entity_type, a.entity_id
    FROM task_activity a
    WHERE a.kind = 'comment'
      AND a.body IS NOT NULL
      AND (
        NOT EXISTS (
          SELECT 1 FROM knowledge_chunks c
          WHERE c.source = 'comment' AND c.source_id = a.id
        )
        OR (
          a.edited_at IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM knowledge_chunks c
            WHERE c.source = 'comment' AND c.source_id = a.id AND c.updated_at < a.edited_at
          )
        )
      )
    LIMIT ${SWEEP_LIMIT}
  `);
  return result.rows.flatMap((row) =>
    isIndexedType(row.entity_type) ? [{ entityType: row.entity_type, entityId: row.entity_id }] : [],
  );
}

async function documentsWithFreshExtraction(): Promise<number[]> {
  const result = await db.execute<{ document_id: number }>(sql`
    SELECT e.document_id
    FROM document_extractions e
    WHERE e.status = 'ready'
      AND (
        NOT EXISTS (
          SELECT 1 FROM knowledge_chunks c
          WHERE c.entity_type = 'document'
            AND c.entity_id = e.document_id
            AND c.source = 'extraction'
        )
        OR e.updated_at > (
          SELECT max(c.updated_at) FROM knowledge_chunks c
          WHERE c.entity_type = 'document' AND c.entity_id = e.document_id
        )
      )
    LIMIT ${SWEEP_LIMIT}
  `);
  return result.rows.map((row) => row.document_id);
}

function isIndexedType(value: string): value is EntityType {
  return (KNOWLEDGE_ENTITY_ORDER as readonly string[]).includes(value);
}

function sourceTable(entityType: EntityType): string {
  switch (entityType) {
    case "idea":
      return "ideas";
    case "project":
      return "projects";
    case "task":
      return "tasks";
    case "todo":
      return "todos";
    case "document":
      return "project_documents";
    case "todo_list":
      return "todo_lists";
    case "board":
      return "boards";
    case "canvas":
      return "canvases";
    case "wiki_node":
      return "wiki_nodes";
    case "image_board":
      return "image_boards";
  }
}

function aliveSql(entityType: EntityType) {
  if (entityType === "task" || entityType === "todo") return sql`s.state <> 'deleted'`;
  return sql`true`;
}
