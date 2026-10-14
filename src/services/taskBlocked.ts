import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import {
  isDependencyBlockingState,
  listRequiredBy,
  openDependsOnBlockers,
} from "./taskDependencies.js";
import { recomputeTaskRollups } from "./taskRollup.js";
import { recordTaskChanges, type RecordTaskChangesOpts } from "./tasks.js";

type Db = NodePgDatabase<typeof schema>;

/** Draft or In Progress → Ready is stored as Blocked while any Depends-on task is still open. */
export function coerceReadyToBlocked(
  from: string,
  requested: string,
  hasOpenDependsOn: boolean,
): string {
  const returningToReady = from === "new" || from === "in_progress";
  if (returningToReady && requested === "ready" && hasOpenDependsOn) return "blocked";
  return requested;
}

/** A task that just became a satisfied prerequisite can release Blocked dependents. */
export function shouldPromoteBlockedDependents(before: string, after: string): boolean {
  return before !== after && isDependencyBlockingState(before) && !isDependencyBlockingState(after);
}

/** Blocked → Ready when every Depends-on is satisfied. No-op otherwise. */
export async function promoteBlockedTaskIfClear(
  db: Db,
  taskId: number,
  opts: RecordTaskChangesOpts,
): Promise<void> {
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
  if (!task || task.state !== "blocked") return;
  if (!task.stateManual && task.rollupTotal != null) return;
  const blockers = await openDependsOnBlockers(db, taskId);
  if (blockers.length > 0) return;
  const [updated] = await db
    .update(schema.tasks)
    .set({
      state: "ready",
      updatedAt: new Date(),
      ...(opts.actorId != null ? { updatedById: opts.actorId } : {}),
    })
    .where(eq(schema.tasks.id, task.id))
    .returning();
  if (updated) {
    await recordTaskChanges(db, task.id, task, updated, { ...opts, recordHistory: true });
    await recomputeTaskRollups(db, [task.id], opts);
  }
}

/** After a prerequisite is satisfied, promote each Blocked task that required it. */
export async function promoteBlockedDependents(
  db: Db,
  taskId: number,
  opts: RecordTaskChangesOpts,
): Promise<void> {
  const requiredBy = await listRequiredBy(db, taskId);
  for (const dependent of requiredBy) {
    if (dependent.state !== "blocked") continue;
    await promoteBlockedTaskIfClear(db, dependent.id, opts);
  }
}
