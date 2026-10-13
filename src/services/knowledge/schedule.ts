import type { EntityType } from "../../lib/entityType.js";
import { enqueue } from "../jobs/queue.js";
import { deleteKnowledgeChunks } from "./indexRecord.js";
import { JOB_KNOWLEDGE_INDEX_PROJECT, JOB_KNOWLEDGE_INDEX_RECORD } from "./jobNames.js";

export async function scheduleKnowledgeIndex(entityType: EntityType, entityId: number): Promise<void> {
  try {
    await enqueue(
      JOB_KNOWLEDGE_INDEX_RECORD,
      { entityType, entityId },
      { singletonKey: `${entityType}:${entityId}` },
    );
  } catch (err) {
    console.error("[knowledge] enqueue failed", err);
  }
}

export async function scheduleProjectKnowledgeIndex(projectId: number): Promise<void> {
  try {
    await enqueue(JOB_KNOWLEDGE_INDEX_PROJECT, { projectId }, { singletonKey: String(projectId) });
  } catch (err) {
    console.error("[knowledge] project enqueue failed", err);
  }
}

/** Drop index rows in this request. Used when a record is deleted or soft-deleted. */
export async function forgetKnowledge(entityType: EntityType, entityId: number): Promise<void> {
  await deleteKnowledgeChunks(entityType, entityId);
}
