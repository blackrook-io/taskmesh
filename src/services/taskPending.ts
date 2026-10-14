import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { isFinishedChildState } from "../lib/taskFields.js";
import { coerceReadyToBlocked } from "./taskBlocked.js";
import { openDependsOnBlockers } from "./taskDependencies.js";
import { recomputeTaskRollups } from "./taskRollup.js";
import { recordTaskChanges, type RecordTaskChangesOpts } from "./tasks.js";

type Db = NodePgDatabase<typeof schema>;

export function coerceCompleteIfUnfinishedChildren(
  requested: string,
  hasUnfinishedChildren: boolean,
): string {
  if (requested === "complete" && hasUnfinishedChildren) return "pending";
  return requested;
}

export function canPromotePendingParent(
  parentState: string,
  childStates: string[],
): boolean {
  if (parentState !== "pending") return false;
  return childStates.every(isFinishedChildState);
}

export async function hasUnfinishedDirectChildren(db: Db, taskId: number): Promise<boolean> {
  const children = await db
    .select({ state: schema.tasks.state })
    .from(schema.tasks)
    .where(eq(schema.tasks.parentId, taskId));
  return children.some((c) => !isFinishedChildState(c.state));
}

export async function resolvePersistedState(
  db: Db,
  taskId: number,
  fromState: string,
  requested: string | undefined,
): Promise<string | undefined> {
  if (requested === undefined) return undefined;
  const unfinished = await hasUnfinishedDirectChildren(db, taskId);
  const afterChildren = coerceCompleteIfUnfinishedChildren(requested, unfinished);
  if ((fromState === "new" || fromState === "in_progress") && afterChildren === "ready") {
    const blockers = await openDependsOnBlockers(db, taskId);
    return coerceReadyToBlocked(fromState, afterChildren, blockers.length > 0);
  }
  return afterChildren;
}

async function promotePendingParentChain(
  db: Db,
  startParentId: number,
  opts: RecordTaskChangesOpts,
): Promise<void> {
  let parentId: number | null = startParentId;
  while (parentId != null) {
    const [parent] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, parentId));
    if (!parent) break;
    const nextParentId = parent.parentId;
    if (!parent.stateManual) {
      parentId = nextParentId;
      continue;
    }
    const children = await db
      .select({ state: schema.tasks.state })
      .from(schema.tasks)
      .where(eq(schema.tasks.parentId, parent.id));
    if (!canPromotePendingParent(parent.state, children.map((c) => c.state))) {
      break;
    }
    const [updated] = await db
      .update(schema.tasks)
      .set({
        state: "complete",
        updatedAt: new Date(),
        ...(opts.actorId != null ? { updatedById: opts.actorId } : {}),
      })
      .where(eq(schema.tasks.id, parent.id))
      .returning();
    if (updated) {
      await recordTaskChanges(db, parent.id, parent, updated, opts);
    }
    parentId = nextParentId;
  }
}

/** After a child state/parent change, complete Pending ancestors whose children are all finished. */
export async function promotePendingAncestors(
  db: Db,
  fromTaskId: number,
  opts: RecordTaskChangesOpts,
): Promise<void> {
  const [row] = await db
    .select({ parentId: schema.tasks.parentId })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, fromTaskId));
  if (row?.parentId != null) {
    await promotePendingParentChain(db, row.parentId, opts);
  }
}

export async function afterTaskHierarchyChange(
  db: Db,
  persistedId: number,
  previousParentId: number | null,
  opts: RecordTaskChangesOpts,
): Promise<void> {
  await promotePendingAncestors(db, persistedId, opts);
  const [row] = await db
    .select({ parentId: schema.tasks.parentId })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, persistedId));
  const currentParent = row?.parentId ?? null;
  if (previousParentId != null && previousParentId !== currentParent) {
    await promotePendingParentChain(db, previousParentId, opts);
  }
  const starts = [persistedId];
  if (previousParentId != null) starts.push(previousParentId);
  await recomputeTaskRollups(db, starts, opts);
}
