import type { EntityType } from "../../../lib/entityType.js";
import { enqueue } from "../../jobs/queue.js";
import { JOB_AI_TAG_RECORD } from "./jobNames.js";

export async function scheduleAutoTag(
  entityType: EntityType,
  entityId: number,
  contentHash: string,
): Promise<void> {
  try {
    await enqueue(
      JOB_AI_TAG_RECORD,
      { entityType, entityId },
      { singletonKey: `${entityType}:${entityId}:${contentHash}` },
    );
  } catch (err) {
    console.error("[tagging] enqueue failed", err);
  }
}
