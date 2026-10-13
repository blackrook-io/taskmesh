import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { isEntityType, type EntityType } from "../../lib/entityType.js";
import { resolveEffectiveAiAccess } from "../assistant/projectAiAccess.js";
import { chunkMarkdown, contentHash, titleChunkText, type TextChunk } from "./chunk.js";
import { embedTexts, readEmbeddingModel } from "./embed.js";
import { EMBEDDING_DIM, reusedEmbedding, shouldEmbedRecord, type StoredEmbedding } from "./embedDecision.js";

const EMBED_BATCH = 32;

type Draft = {
  source: "title" | "body" | "comment" | "extraction";
  sourceId: number;
  chunkIndex: number;
  heading: string | null;
  locator: number | null;
  startOffset: number;
  endOffset: number;
  content: string;
  hash: string;
};

export async function indexKnowledgeRecord(entityType: string, entityId: number): Promise<void> {
  if (!isEntityType(entityType) || !Number.isInteger(entityId) || entityId <= 0) return;
  const loaded = await loadRecord(entityType, entityId);
  if (!loaded) {
    await deleteKnowledgeChunks(entityType, entityId);
    return;
  }
  const drafts = buildDrafts(entityType, loaded);
  const existing = await db
    .select({
      source: schema.knowledgeChunks.source,
      sourceId: schema.knowledgeChunks.sourceId,
      chunkIndex: schema.knowledgeChunks.chunkIndex,
      contentHash: schema.knowledgeChunks.contentHash,
      embeddingModel: schema.knowledgeChunks.embeddingModel,
      embedding: schema.knowledgeChunks.embedding,
    })
    .from(schema.knowledgeChunks)
    .where(
      and(
        eq(schema.knowledgeChunks.entityType, entityType),
        eq(schema.knowledgeChunks.entityId, entityId),
      ),
    );
  const previous = new Map<string, StoredEmbedding>();
  for (const row of existing) {
    previous.set(`${row.source}:${row.sourceId}:${row.chunkIndex}`, {
      hash: row.contentHash,
      model: row.embeddingModel,
      embedding: row.embedding,
    });
  }
  const modelHint = await readEmbeddingModel();
  const vectors = new Array<number[] | null | undefined>(drafts.length);
  const pending: number[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    if (!draft) continue;
    const reused = reusedEmbedding(
      previous.get(`${draft.source}:${draft.sourceId}:${draft.chunkIndex}`),
      draft.hash,
      modelHint,
      loaded.embed,
    );
    vectors[i] = reused;
    if (reused === undefined) pending.push(i);
  }
  let embeddedModel: string | null = modelHint;
  if (pending.length > 0) {
    const batch = await embedTexts(pending.map((index) => drafts[index]?.content ?? ""));
    if (!batch || batch.vectors == null) {
      for (const index of pending) vectors[index] = null;
    } else {
      embeddedModel = batch.model || modelHint;
      pending.forEach((index, order) => {
        vectors[index] = batch.vectors?.[order] ?? null;
      });
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.knowledgeChunks)
      .where(
        and(
          eq(schema.knowledgeChunks.entityType, entityType),
          eq(schema.knowledgeChunks.entityId, entityId),
        ),
      );
    for (let i = 0; i < drafts.length; i++) {
      const draft = drafts[i];
      if (!draft) continue;
      const embedding = vectors[i];
      const stored =
        embedding && embedding.length === EMBEDDING_DIM ? embedding : null;
      const model = stored ? embeddedModel : null;
      await tx.execute(sql`
        INSERT INTO knowledge_chunks (
          entity_type, entity_id, project_id, source, source_id, chunk_index,
          heading, locator, start_offset, end_offset, content, content_tsv,
          content_hash, embedding, embedding_model, updated_at
        ) VALUES (
          ${entityType},
          ${entityId},
          ${loaded.projectId},
          ${draft.source},
          ${draft.sourceId},
          ${draft.chunkIndex},
          ${draft.heading},
          ${draft.locator},
          ${draft.startOffset},
          ${draft.endOffset},
          ${draft.content},
          to_tsvector('simple', ${draft.content}),
          ${draft.hash},
          ${stored ? vectorParam(stored) : null}::vector,
          ${model},
          now()
        )
      `);
    }
  });
}

export async function deleteKnowledgeChunks(entityType: string, entityId: number): Promise<void> {
  await db
    .delete(schema.knowledgeChunks)
    .where(
      and(eq(schema.knowledgeChunks.entityType, entityType), eq(schema.knowledgeChunks.entityId, entityId)),
    );
}

type Loaded = {
  projectId: number | null;
  number: number;
  title: string;
  body: string | null;
  embed: boolean;
  spans: Array<{ id: number; locator: number; label: string; text: string }>;
  comments: Array<{ id: number; body: string }>;
};

function buildDrafts(entityType: EntityType, loaded: Loaded): Draft[] {
  const drafts: Draft[] = [];
  const title = titleChunkText(entityType, loaded.number, loaded.title);
  if (title) pushPieces(drafts, "title", 0, null, chunkMarkdown(title));
  if (loaded.body?.trim()) pushPieces(drafts, "body", 0, null, chunkMarkdown(loaded.body));
  for (const comment of loaded.comments) {
    pushPieces(drafts, "comment", comment.id, null, chunkMarkdown(comment.body));
  }
  for (const span of loaded.spans) {
    pushPieces(drafts, "extraction", span.id, span.locator, chunkMarkdown(span.text), span.label);
  }
  return drafts;
}

function pushPieces(
  drafts: Draft[],
  source: Draft["source"],
  sourceId: number,
  locator: number | null,
  pieces: TextChunk[],
  headingOverride?: string,
): void {
  pieces.forEach((piece, chunkIndex) => {
    drafts.push({
      source,
      sourceId,
      chunkIndex,
      heading: headingOverride ?? piece.heading,
      locator,
      startOffset: piece.startOffset,
      endOffset: piece.endOffset,
      content: piece.content,
      hash: contentHash(piece.content),
    });
  });
}

function vectorParam(values: number[]): string {
  return `[${values.map((value) => {
    if (!Number.isFinite(value)) throw new Error("embedding value is not finite");
    return String(value);
  }).join(",")}]`;
}

async function loadRecord(entityType: EntityType, entityId: number): Promise<Loaded | null> {
  const comments = await loadComments(entityType, entityId);
  if (entityType === "idea") {
    const [row] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, entityId));
    if (!row) return null;
    return pack(null, row.number, row.title, row.body, true, [], comments);
  }
  if (entityType === "project") {
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, entityId));
    if (!row) return null;
    const access = await resolveEffectiveAiAccess(db, row.id);
    return pack(row.id, row.number, row.name, row.description, shouldEmbedRecord(row.id, access), [], comments);
  }
  if (entityType === "task") {
    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, entityId));
    if (!row || row.state === "deleted") return null;
    return pack(row.projectId, row.number, row.title, row.description, await embedFor(row.projectId), [], comments);
  }
  if (entityType === "todo") {
    const [row] = await db.select().from(schema.todos).where(eq(schema.todos.id, entityId));
    if (!row || row.state === "deleted") return null;
    return pack(row.projectId, row.number, row.title, row.description, await embedFor(row.projectId), [], comments);
  }
  if (entityType === "document") {
    const [row] = await db
      .select()
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.id, entityId));
    if (!row) return null;
    const spans =
      row.kind === "markdown" ? [] : await loadSpans(row.id);
    const body = row.kind === "markdown" ? row.body : null;
    return pack(row.projectId, row.number, row.title, body, await embedFor(row.projectId), spans, comments);
  }
  if (entityType === "todo_list") {
    const [row] = await db.select().from(schema.todoLists).where(eq(schema.todoLists.id, entityId));
    if (!row) return null;
    return pack(row.projectId, row.number, row.title, null, await embedFor(row.projectId), [], comments);
  }
  if (entityType === "board") {
    const [row] = await db.select().from(schema.boards).where(eq(schema.boards.id, entityId));
    if (!row) return null;
    return pack(row.projectId, row.number, row.name, null, await embedFor(row.projectId), [], comments);
  }
  if (entityType === "canvas") {
    const [row] = await db.select().from(schema.canvases).where(eq(schema.canvases.id, entityId));
    if (!row) return null;
    return pack(row.projectId, row.number, row.title, null, await embedFor(row.projectId), [], comments);
  }
  if (entityType === "wiki_node") {
    const [row] = await db.select().from(schema.wikiNodes).where(eq(schema.wikiNodes.id, entityId));
    if (!row) return null;
    return pack(row.projectId, row.number, row.title, null, await embedFor(row.projectId), [], comments);
  }
  const [row] = await db.select().from(schema.imageBoards).where(eq(schema.imageBoards.id, entityId));
  if (!row) return null;
  return pack(row.projectId, row.number, row.title, null, await embedFor(row.projectId), [], comments);
}

function pack(
  projectId: number | null,
  number: number,
  title: string,
  body: string | null,
  embed: boolean,
  spans: Loaded["spans"],
  comments: Loaded["comments"],
): Loaded {
  return { projectId, number, title, body, embed, spans, comments };
}

async function embedFor(projectId: number | null): Promise<boolean> {
  if (projectId == null) return true;
  return shouldEmbedRecord(projectId, await resolveEffectiveAiAccess(db, projectId));
}

async function loadComments(
  entityType: EntityType,
  entityId: number,
): Promise<Array<{ id: number; body: string }>> {
  const rows = await db
    .select({ id: schema.taskActivity.id, body: schema.taskActivity.body })
    .from(schema.taskActivity)
    .where(
      and(
        eq(schema.taskActivity.entityType, entityType),
        eq(schema.taskActivity.entityId, entityId),
        eq(schema.taskActivity.kind, "comment"),
      ),
    );
  return rows.flatMap((row) => (row.body?.trim() ? [{ id: row.id, body: row.body }] : []));
}

async function loadSpans(documentId: number): Promise<Loaded["spans"]> {
  const [extraction] = await db
    .select({ status: schema.documentExtractions.status })
    .from(schema.documentExtractions)
    .where(eq(schema.documentExtractions.documentId, documentId));
  if (extraction?.status !== "ready") return [];
  const rows = await db
    .select({
      id: schema.documentTextSpans.id,
      locator: schema.documentTextSpans.locator,
      label: schema.documentTextSpans.label,
      text: schema.documentTextSpans.text,
    })
    .from(schema.documentTextSpans)
    .where(eq(schema.documentTextSpans.documentId, documentId));
  return rows.filter((row) => row.text.trim().length > 0);
}
