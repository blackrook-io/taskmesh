import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type { EntityType } from "../lib/entityType.js";

type Db = NodePgDatabase<typeof schema>;

/** Copy taggings from one entity onto another (skip duplicates). */
export async function copyTaggings(
  db: Db,
  from: { entityType: EntityType; entityId: number },
  to: { entityType: EntityType; entityId: number },
): Promise<void> {
  const rows = await db
    .select({ tagId: schema.taggings.tagId })
    .from(schema.taggings)
    .where(
      and(
        eq(schema.taggings.entityType, from.entityType),
        eq(schema.taggings.entityId, from.entityId),
      ),
    );
  for (const { tagId } of rows) {
    try {
      await db.insert(schema.taggings).values({
        tagId,
        entityType: to.entityType,
        entityId: to.entityId,
      });
    } catch (err) {
      const pg = err as { code?: string };
      if (pg.code === "23505") continue;
      throw err;
    }
  }
}
