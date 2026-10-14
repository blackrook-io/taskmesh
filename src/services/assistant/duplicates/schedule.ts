import type { EntityType } from "../../../lib/entityType.js";
import { enqueue } from "../../jobs/queue.js";
import { isDuplicateEntityType } from "./match.js";
import { JOB_AI_DUPLICATE_RECORD } from "./jobNames.js";

export async function scheduleDuplicateCheck(entityType: EntityType, entityId: number): Promise<void> {
  if (!isDuplicateEntityType(entityType)) return;
  try {
    await enqueue(
      JOB_AI_DUPLICATE_RECORD,
      { entityType, entityId },
      { singletonKey: `${entityType}:${entityId}` },
    );
  } catch (err) {
    console.error("[duplicates] enqueue failed", err);
  }
}
