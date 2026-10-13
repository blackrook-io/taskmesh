import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { isEntityType, type EntityType } from "../../lib/entityType.js";

export const KNOWLEDGE_CURSOR_KEY = "knowledge_index_cursor";

export const KNOWLEDGE_ENTITY_ORDER = [
  "idea",
  "project",
  "task",
  "todo",
  "document",
  "todo_list",
  "board",
  "canvas",
  "wiki_node",
  "image_board",
] as const satisfies readonly EntityType[];

export type KnowledgeCursor = {
  status: "idle" | "running";
  entityType: EntityType;
  afterId: number;
};

const IDLE: KnowledgeCursor = { status: "idle", entityType: "idea", afterId: 0 };

export async function readKnowledgeCursor(): Promise<KnowledgeCursor> {
  const [row] = await db
    .select({ value: schema.systemProperties.value })
    .from(schema.systemProperties)
    .where(eq(schema.systemProperties.key, KNOWLEDGE_CURSOR_KEY));
  return parseCursor(row?.value) ?? IDLE;
}

export async function writeKnowledgeCursor(cursor: KnowledgeCursor): Promise<void> {
  await db
    .insert(schema.systemProperties)
    .values({ key: KNOWLEDGE_CURSOR_KEY, value: cursor, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.systemProperties.key,
      set: { value: cursor, updatedAt: new Date() },
    });
}

function parseCursor(value: unknown): KnowledgeCursor | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as { status?: unknown; entityType?: unknown; afterId?: unknown };
  if (rec.status !== "idle" && rec.status !== "running") return null;
  if (typeof rec.entityType !== "string" || !isEntityType(rec.entityType)) return null;
  if (typeof rec.afterId !== "number" || !Number.isInteger(rec.afterId) || rec.afterId < 0) return null;
  return { status: rec.status, entityType: rec.entityType, afterId: rec.afterId };
}
