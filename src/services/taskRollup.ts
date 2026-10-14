import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { rollupUpdates, type RollupNode } from "../lib/taskRollup.js";
import { recordTaskChanges, type RecordTaskChangesOpts } from "./tasks.js";

type Db = NodePgDatabase<typeof schema>;

/** Refresh derived status and counts for the given tasks and their ancestors. */
export async function recomputeTaskRollups(
  db: Db,
  startIds: number[],
  opts: RecordTaskChangesOpts,
): Promise<void> {
  const ids = [...new Set(startIds.filter((id) => Number.isInteger(id)))];
  if (ids.length === 0) return;

  const rows = await db
    .select({
      id: schema.tasks.id,
      parentId: schema.tasks.parentId,
      state: schema.tasks.state,
      stateManual: schema.tasks.stateManual,
      rollupDone: schema.tasks.rollupDone,
      rollupTotal: schema.tasks.rollupTotal,
    })
    .from(schema.tasks);

  const updates = rollupUpdates(rows as RollupNode[], ids);
  for (const update of updates) {
    const [before] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, update.id));
    if (!before) continue;
    const [after] = await db
      .update(schema.tasks)
      .set({
        state: update.state,
        rollupDone: update.rollupDone,
        rollupTotal: update.rollupTotal,
        updatedAt: new Date(),
        ...(opts.actorId != null ? { updatedById: opts.actorId } : {}),
      })
      .where(eq(schema.tasks.id, update.id))
      .returning();
    if (after && before.state !== after.state) {
      await recordTaskChanges(db, update.id, before, after, opts);
    }
  }
}
