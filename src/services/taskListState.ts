import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

export const TASK_LIST_STATE_KINDS = ["group", "ungrouped", "parent"] as const;
export type TaskListStateKind = (typeof TASK_LIST_STATE_KINDS)[number];

export type TaskListState = {
  collapsedGroupIds: number[];
  collapsedUngroupedProjectIds: number[];
  collapsedParentIds: number[];
};

export const EMPTY_TASK_LIST_STATE: TaskListState = {
  collapsedGroupIds: [],
  collapsedUngroupedProjectIds: [],
  collapsedParentIds: [],
};

function columnForKind(kind: TaskListStateKind): keyof TaskListState {
  if (kind === "group") return "collapsedGroupIds";
  if (kind === "ungrouped") return "collapsedUngroupedProjectIds";
  return "collapsedParentIds";
}

/** Keep positive integers, drop anything else, preserve first-seen order. */
export function normalizeIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item) || item <= 0) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function taskListStateFromRow(row: {
  collapsedGroupIds: unknown;
  collapsedUngroupedProjectIds: unknown;
  collapsedParentIds: unknown;
}): TaskListState {
  return {
    collapsedGroupIds: normalizeIdList(row.collapsedGroupIds),
    collapsedUngroupedProjectIds: normalizeIdList(row.collapsedUngroupedProjectIds),
    collapsedParentIds: normalizeIdList(row.collapsedParentIds),
  };
}

/** Add or remove one id. Returns the same object when nothing changes. */
export function applyTaskListStateToggle(
  state: TaskListState,
  kind: TaskListStateKind,
  id: number,
  collapsed: boolean,
): TaskListState {
  const key = columnForKind(kind);
  const current = state[key];
  const has = current.includes(id);
  if (collapsed === has) return state;
  const nextIds = collapsed ? [...current, id] : current.filter((n) => n !== id);
  return { ...state, [key]: nextIds };
}

export async function getTaskListState(db: Db, userId: number): Promise<TaskListState> {
  const [row] = await db
    .select({
      collapsedGroupIds: schema.userTaskListState.collapsedGroupIds,
      collapsedUngroupedProjectIds: schema.userTaskListState.collapsedUngroupedProjectIds,
      collapsedParentIds: schema.userTaskListState.collapsedParentIds,
    })
    .from(schema.userTaskListState)
    .where(eq(schema.userTaskListState.userId, userId))
    .limit(1);
  if (!row) return EMPTY_TASK_LIST_STATE;
  return taskListStateFromRow(row);
}

/**
 * Apply one collapse toggle under a row lock so overlapping requests
 * cannot drop each other's ids.
 */
export async function patchTaskListState(
  db: Db,
  userId: number,
  kind: TaskListStateKind,
  id: number,
  collapsed: boolean,
): Promise<TaskListState> {
  return db.transaction(async (tx) => {
    await tx.insert(schema.userTaskListState).values({ userId }).onConflictDoNothing();
    const [row] = await tx
      .select({
        collapsedGroupIds: schema.userTaskListState.collapsedGroupIds,
        collapsedUngroupedProjectIds: schema.userTaskListState.collapsedUngroupedProjectIds,
        collapsedParentIds: schema.userTaskListState.collapsedParentIds,
      })
      .from(schema.userTaskListState)
      .where(eq(schema.userTaskListState.userId, userId))
      .for("update");
    if (!row) {
      throw Object.assign(new Error("Task list state row missing after insert"), {
        status: 500,
        code: "task_list_state_missing",
      });
    }
    const current = taskListStateFromRow(row);
    const next = applyTaskListStateToggle(current, kind, id, collapsed);
    if (next === current) return current;
    await tx
      .update(schema.userTaskListState)
      .set({
        collapsedGroupIds: next.collapsedGroupIds,
        collapsedUngroupedProjectIds: next.collapsedUngroupedProjectIds,
        collapsedParentIds: next.collapsedParentIds,
        updatedAt: new Date(),
      })
      .where(eq(schema.userTaskListState.userId, userId));
    return next;
  });
}
