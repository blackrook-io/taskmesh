import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { isEmptyTaskGroupFilter } from "../lib/taskGroupFilter.js";

type Db = NodePgDatabase<typeof schema>;

export type TaskGroupRow = typeof schema.taskGroups.$inferSelect;

export type TaskGroupWithMembers = TaskGroupRow & { memberTaskIds: number[] };

export async function memberTaskIdsByGroupId(
  database: Db,
  groupIds: number[],
): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  for (const id of groupIds) map.set(id, []);
  if (groupIds.length === 0) return map;
  const rows = await database
    .select({
      groupId: schema.taskGroupMembers.groupId,
      taskId: schema.taskGroupMembers.taskId,
    })
    .from(schema.taskGroupMembers)
    .where(inArray(schema.taskGroupMembers.groupId, groupIds));
  for (const row of rows) {
    const list = map.get(row.groupId) ?? [];
    list.push(row.taskId);
    map.set(row.groupId, list);
  }
  return map;
}

export async function attachMemberTaskIds(
  database: Db,
  groups: TaskGroupRow[],
): Promise<TaskGroupWithMembers[]> {
  const byGroup = await memberTaskIdsByGroupId(
    database,
    groups.map((g) => g.id),
  );
  return groups.map((g) => ({
    ...g,
    memberTaskIds: byGroup.get(g.id) ?? [],
  }));
}

export async function clearGroupMembers(database: Db, groupId: number): Promise<void> {
  await database
    .delete(schema.taskGroupMembers)
    .where(eq(schema.taskGroupMembers.groupId, groupId));
}

/** Add a task to a manual (no-filter) group. Idempotent. */
export async function addGroupMember(
  database: Db,
  opts: { projectId: number; groupId: number; taskId: number },
): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
  const [group] = await database
    .select()
    .from(schema.taskGroups)
    .where(eq(schema.taskGroups.id, opts.groupId));
  if (!group || group.projectId !== opts.projectId) {
    return { ok: false, status: 404, code: "not_found", message: "Group not found" };
  }
  if (!isEmptyTaskGroupFilter(group.filter)) {
    return {
      ok: false,
      status: 400,
      code: "filter_group",
      message: "Cannot manually add members to a group that has a filter",
    };
  }
  const [task] = await database.select().from(schema.tasks).where(eq(schema.tasks.id, opts.taskId));
  if (!task || task.projectId !== opts.projectId || task.state === "deleted") {
    return { ok: false, status: 404, code: "not_found", message: "Task not found in this project" };
  }
  const [dup] = await database
    .select()
    .from(schema.taskGroupMembers)
    .where(
      and(
        eq(schema.taskGroupMembers.groupId, opts.groupId),
        eq(schema.taskGroupMembers.taskId, opts.taskId),
      ),
    );
  if (dup) return { ok: true };
  await database.insert(schema.taskGroupMembers).values({
    groupId: opts.groupId,
    taskId: opts.taskId,
  });
  return { ok: true };
}

export async function removeGroupMember(
  database: Db,
  opts: { projectId: number; groupId: number; taskId: number },
): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
  const [group] = await database
    .select()
    .from(schema.taskGroups)
    .where(eq(schema.taskGroups.id, opts.groupId));
  if (!group || group.projectId !== opts.projectId) {
    return { ok: false, status: 404, code: "not_found", message: "Group not found" };
  }
  await database
    .delete(schema.taskGroupMembers)
    .where(
      and(
        eq(schema.taskGroupMembers.groupId, opts.groupId),
        eq(schema.taskGroupMembers.taskId, opts.taskId),
      ),
    );
  return { ok: true };
}
