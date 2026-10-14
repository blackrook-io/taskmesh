import { and, asc, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { isEntityType, type EntityType } from "../../lib/entityType.js";
import { isTaggableEntityType } from "../entities.js";
import { scheduleDuplicateCheck } from "../assistant/duplicates/schedule.js";
import { scheduleAutoTag } from "../assistant/tagging/schedule.js";
import type { JobDefinition } from "../jobs/definitions.js";
import { enqueue, registerJob } from "../jobs/queue.js";
import { KNOWLEDGE_ENTITY_ORDER, readKnowledgeCursor, writeKnowledgeCursor } from "./cursor.js";
import { indexKnowledgeRecord } from "./indexRecord.js";
import {
  JOB_KNOWLEDGE_INDEX_PROJECT,
  JOB_KNOWLEDGE_INDEX_RECORD,
  JOB_KNOWLEDGE_INDEX_SWEEP,
  JOB_KNOWLEDGE_REINDEX,
  KNOWLEDGE_SWEEP_CRON,
} from "./jobNames.js";
import { scheduleKnowledgeIndex } from "./schedule.js";
import { sweepKnowledgeIndex } from "./sweep.js";

const REINDEX_BATCH = 15;

export const KNOWLEDGE_RECORD_JOB: JobDefinition = {
  name: JOB_KNOWLEDGE_INDEX_RECORD,
  label: "Knowledge index record",
  retryLimit: 3,
  retryDelaySeconds: 20,
  retryBackoff: true,
  concurrency: 2,
  policy: "short",
  expireInSeconds: 120,
  cron: null,
};

export const KNOWLEDGE_REINDEX_JOB: JobDefinition = {
  name: JOB_KNOWLEDGE_REINDEX,
  label: "Knowledge index rebuild",
  retryLimit: 2,
  retryDelaySeconds: 30,
  retryBackoff: true,
  concurrency: 1,
  policy: "short",
  expireInSeconds: 180,
  cron: null,
};

export const KNOWLEDGE_SWEEP_JOB: JobDefinition = {
  name: JOB_KNOWLEDGE_INDEX_SWEEP,
  label: "Knowledge index sweep",
  retryLimit: 1,
  retryDelaySeconds: 60,
  retryBackoff: false,
  concurrency: 1,
  policy: "short",
  expireInSeconds: 10 * 60,
  cron: KNOWLEDGE_SWEEP_CRON,
  runOnStartAfterSeconds: 60,
};

export const KNOWLEDGE_PROJECT_JOB: JobDefinition = {
  name: JOB_KNOWLEDGE_INDEX_PROJECT,
  label: "Knowledge index project",
  retryLimit: 2,
  retryDelaySeconds: 30,
  retryBackoff: true,
  concurrency: 1,
  policy: "short",
  expireInSeconds: 120,
  cron: null,
};

export function registerKnowledgeJobs(): void {
  registerJob(KNOWLEDGE_RECORD_JOB, (data) => runIfIndexed(() => indexRecordJob(data)));
  registerJob(KNOWLEDGE_REINDEX_JOB, () => runIfIndexed(() => reindexBatch()));
  registerJob(KNOWLEDGE_SWEEP_JOB, () => runIfIndexed(() => sweepKnowledgeIndex()));
  registerJob(KNOWLEDGE_PROJECT_JOB, (data) => runIfIndexed(() => indexProjectJob(data)));
}

async function runIfIndexed(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    if (isMissingKnowledgeTable(err)) return;
    throw err;
  }
}

function isMissingKnowledgeTable(err: unknown): boolean {
  const cause =
    err && typeof err === "object" && "cause" in err
      ? (err as { cause?: { code?: string } }).cause
      : undefined;
  const code = cause?.code ?? (err as { code?: string } | null)?.code;
  return code === "42P01";
}

export async function startKnowledgeRebuild(): Promise<"started" | "running"> {
  const cursor = await readKnowledgeCursor();
  if (cursor.status === "running") return "running";
  const first = KNOWLEDGE_ENTITY_ORDER[0];
  await writeKnowledgeCursor({ status: "running", entityType: first, afterId: 0 });
  try {
    await enqueue(JOB_KNOWLEDGE_REINDEX, { step: `${first}:0` }, { singletonKey: `rebuild:${first}:0` });
  } catch (err) {
    await writeKnowledgeCursor({ status: "idle", entityType: first, afterId: 0 });
    throw err;
  }
  return "started";
}

/** When the index has no rows, start a rebuild. If a rebuild was already in progress, continue it. */
export async function resumeKnowledgeRebuild(): Promise<void> {
  try {
    await resumeKnowledgeRebuildInner();
  } catch (err) {
    const code =
      err && typeof err === "object" && "cause" in err
        ? (err.cause as { code?: string } | undefined)?.code
        : undefined;
    if (code === "42P01") {
      console.error("[knowledge] index table is missing; run migrations");
      return;
    }
    throw err;
  }
}

async function resumeKnowledgeRebuildInner(): Promise<void> {
  const cursor = await readKnowledgeCursor();
  if (cursor.status === "running") {
    await enqueue(
      JOB_KNOWLEDGE_REINDEX,
      { step: `${cursor.entityType}:${cursor.afterId}` },
      { singletonKey: `rebuild:${cursor.entityType}:${cursor.afterId}` },
    );
    return;
  }
  const count = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM knowledge_chunks`);
  if ((count.rows[0]?.n ?? 0) === 0) await startKnowledgeRebuild();
}

async function indexRecordJob(data: object): Promise<void> {
  const entityType = "entityType" in data ? data.entityType : null;
  const entityId = "entityId" in data ? data.entityId : null;
  if (typeof entityType !== "string" || !isEntityType(entityType)) return;
  if (typeof entityId !== "number" || !Number.isInteger(entityId) || entityId <= 0) return;
  const indexed = await indexKnowledgeRecord(entityType, entityId);
  if (indexed.textChanged && isTaggableEntityType(entityType)) {
    await scheduleAutoTag(entityType, entityId, indexed.contentHash ?? "empty");
  }
  if (indexed.textChanged) await scheduleDuplicateCheck(entityType, entityId);
}

async function reindexBatch(): Promise<void> {
  const cursor = await readKnowledgeCursor();
  if (cursor.status !== "running") return;
  const ids = await nextIds(cursor.entityType, cursor.afterId);
  for (const id of ids) await indexKnowledgeRecord(cursor.entityType, id);
  if (ids.length > 0) {
    const afterId = ids[ids.length - 1] ?? cursor.afterId;
    await writeKnowledgeCursor({ status: "running", entityType: cursor.entityType, afterId });
    await enqueue(
      JOB_KNOWLEDGE_REINDEX,
      { step: `${cursor.entityType}:${afterId}` },
      { singletonKey: `rebuild:${cursor.entityType}:${afterId}` },
    );
    return;
  }
  const index = (KNOWLEDGE_ENTITY_ORDER as readonly string[]).indexOf(cursor.entityType);
  const next = KNOWLEDGE_ENTITY_ORDER[index + 1];
  if (!next) {
    await writeKnowledgeCursor({ status: "idle", entityType: "idea", afterId: 0 });
    return;
  }
  await writeKnowledgeCursor({ status: "running", entityType: next, afterId: 0 });
  await enqueue(JOB_KNOWLEDGE_REINDEX, { step: `${next}:0` }, { singletonKey: `rebuild:${next}:0` });
}

async function indexProjectJob(data: object): Promise<void> {
  const projectId = "projectId" in data ? data.projectId : null;
  if (typeof projectId !== "number" || !Number.isInteger(projectId) || projectId <= 0) return;
  await scheduleKnowledgeIndex("project", projectId);
  const [tasks, todos, documents, lists, boards, canvases, wiki, images] = await Promise.all([
    db.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.projectId, projectId)),
    db.select({ id: schema.todos.id }).from(schema.todos).where(eq(schema.todos.projectId, projectId)),
    db
      .select({ id: schema.projectDocuments.id })
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.projectId, projectId)),
    db.select({ id: schema.todoLists.id }).from(schema.todoLists).where(eq(schema.todoLists.projectId, projectId)),
    db.select({ id: schema.boards.id }).from(schema.boards).where(eq(schema.boards.projectId, projectId)),
    db.select({ id: schema.canvases.id }).from(schema.canvases).where(eq(schema.canvases.projectId, projectId)),
    db.select({ id: schema.wikiNodes.id }).from(schema.wikiNodes).where(eq(schema.wikiNodes.projectId, projectId)),
    db
      .select({ id: schema.imageBoards.id })
      .from(schema.imageBoards)
      .where(eq(schema.imageBoards.projectId, projectId)),
  ]);
  const groups: Array<{ type: EntityType; ids: number[] }> = [
    { type: "task", ids: tasks.map((row) => row.id) },
    { type: "todo", ids: todos.map((row) => row.id) },
    { type: "document", ids: documents.map((row) => row.id) },
    { type: "todo_list", ids: lists.map((row) => row.id) },
    { type: "board", ids: boards.map((row) => row.id) },
    { type: "canvas", ids: canvases.map((row) => row.id) },
    { type: "wiki_node", ids: wiki.map((row) => row.id) },
    { type: "image_board", ids: images.map((row) => row.id) },
  ];
  for (const group of groups) {
    for (const id of group.ids) await scheduleKnowledgeIndex(group.type, id);
  }
}

async function nextIds(entityType: EntityType, afterId: number): Promise<number[]> {
  if (entityType === "idea") return takeIds(schema.ideas, afterId);
  if (entityType === "project") return takeIds(schema.projects, afterId);
  if (entityType === "task") {
    const rows = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(gt(schema.tasks.id, afterId), ne(schema.tasks.state, "deleted")))
      .orderBy(asc(schema.tasks.id))
      .limit(REINDEX_BATCH);
    return rows.map((row) => row.id);
  }
  if (entityType === "todo") {
    const rows = await db
      .select({ id: schema.todos.id })
      .from(schema.todos)
      .where(and(gt(schema.todos.id, afterId), ne(schema.todos.state, "deleted")))
      .orderBy(asc(schema.todos.id))
      .limit(REINDEX_BATCH);
    return rows.map((row) => row.id);
  }
  if (entityType === "document") return takeIds(schema.projectDocuments, afterId);
  if (entityType === "todo_list") return takeIds(schema.todoLists, afterId);
  if (entityType === "board") return takeIds(schema.boards, afterId);
  if (entityType === "canvas") return takeIds(schema.canvases, afterId);
  if (entityType === "wiki_node") return takeIds(schema.wikiNodes, afterId);
  if (entityType === "image_board") return takeIds(schema.imageBoards, afterId);
  return [];
}

async function takeIds(
  table:
    | typeof schema.ideas
    | typeof schema.projects
    | typeof schema.projectDocuments
    | typeof schema.todoLists
    | typeof schema.boards
    | typeof schema.canvases
    | typeof schema.wikiNodes
    | typeof schema.imageBoards,
  afterId: number,
): Promise<number[]> {
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(gt(table.id, afterId))
    .orderBy(asc(table.id))
    .limit(REINDEX_BATCH);
  return rows.map((row) => row.id);
}
