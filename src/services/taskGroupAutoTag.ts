import { and, eq, inArray, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import {
  taskMatchesGroupFilter,
  type FilterMatchContext,
  type TaskFilterSubject,
} from "../lib/taskListFilterMatch.js";
import {
  isEmptyTaskGroupFilter,
  type TaskGroupFilter,
} from "../lib/taskGroupFilter.js";

type Db = NodePgDatabase<typeof schema>;

export type AutoTagGroup = {
  autoTagId: number;
  filter: TaskGroupFilter;
};

export type AutoTagAttachment = { taskId: number; tagId: number };

function cloneTaskTags(
  initial: ReadonlyMap<number, readonly { id: number; name: string }[]>,
): Map<number, { id: number; name: string }[]> {
  const next = new Map<number, { id: number; name: string }[]>();
  for (const [taskId, tags] of initial) {
    next.set(taskId, tags.map((t) => ({ ...t })));
  }
  return next;
}

/** Fixpoint: apply each group's auto-tag to matching tasks (add-only). */
export function collectAutoTagAttachments(
  groups: AutoTagGroup[],
  tasks: TaskFilterSubject[],
  initialTags: ReadonlyMap<number, readonly { id: number; name: string }[]>,
  extra: {
    phaseNames?: ReadonlyMap<number, string>;
    tagNames: ReadonlyMap<number, string>;
    projectNames?: ReadonlyMap<number, string>;
  },
): AutoTagAttachment[] {
  const live = tasks.filter((t) => t.state !== "deleted");
  const taskTags = cloneTaskTags(initialTags);
  const found: AutoTagAttachment[] = [];
  const seen = new Set<string>();
  const maxPasses = Math.max(1, groups.length + 1);

  for (let pass = 0; pass < maxPasses; pass++) {
    let added = 0;
    for (const group of groups) {
      for (const task of live) {
        const ctx: FilterMatchContext = {
          phaseNames: extra.phaseNames,
          tagNames: extra.tagNames,
          taskTags,
          projectNames: extra.projectNames,
        };
        if (!taskMatchesGroupFilter(task, group.filter, ctx)) continue;
        const existing = taskTags.get(task.id) ?? [];
        if (existing.some((t) => t.id === group.autoTagId)) continue;
        const key = `${task.id}:${group.autoTagId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const name = extra.tagNames.get(group.autoTagId) ?? String(group.autoTagId);
        existing.push({ id: group.autoTagId, name });
        taskTags.set(task.id, existing);
        found.push({ taskId: task.id, tagId: group.autoTagId });
        added += 1;
      }
    }
    if (added === 0) break;
  }
  return found;
}

/** Validate that autoTagId is null or an existing tag. */
export async function assertAutoTagId(
  db: Db,
  autoTagId: number | null | undefined,
): Promise<{ ok: true; autoTagId?: number | null } | { ok: false; message: string }> {
  if (autoTagId === undefined) return { ok: true };
  if (autoTagId === null) return { ok: true, autoTagId: null };
  const [tag] = await db.select({ id: schema.tags.id }).from(schema.tags).where(eq(schema.tags.id, autoTagId));
  if (!tag) return { ok: false, message: "Auto-tag not found" };
  return { ok: true, autoTagId: tag.id };
}

export async function applyTaskGroupAutoTags(
  db: Db,
  opts: { projectId: number; taskId?: number },
): Promise<void> {
  const groups = await db
    .select({
      autoTagId: schema.taskGroups.autoTagId,
      filter: schema.taskGroups.filter,
    })
    .from(schema.taskGroups)
    .where(eq(schema.taskGroups.projectId, opts.projectId));

  const active: AutoTagGroup[] = [];
  for (const g of groups) {
    if (g.autoTagId == null) continue;
    const filter = g.filter;
    if (isEmptyTaskGroupFilter(filter) || !filter) continue;
    active.push({ autoTagId: g.autoTagId, filter });
  }
  if (active.length === 0) return;

  const taskFilters = [eq(schema.tasks.projectId, opts.projectId), ne(schema.tasks.state, "deleted")];
  if (opts.taskId != null) {
    taskFilters.push(eq(schema.tasks.id, opts.taskId));
  }
  const tasks = await db
    .select({
      id: schema.tasks.id,
      number: schema.tasks.number,
      title: schema.tasks.title,
      state: schema.tasks.state,
      priority: schema.tasks.priority,
      phaseId: schema.tasks.phaseId,
      projectId: schema.tasks.projectId,
    })
    .from(schema.tasks)
    .where(and(...taskFilters));
  if (tasks.length === 0) return;

  const taskIds = tasks.map((t) => t.id);
  const taggingRows = await db
    .select({
      entityId: schema.taggings.entityId,
      id: schema.tags.id,
      name: schema.tags.name,
    })
    .from(schema.taggings)
    .innerJoin(schema.tags, eq(schema.taggings.tagId, schema.tags.id))
    .where(and(eq(schema.taggings.entityType, "task"), inArray(schema.taggings.entityId, taskIds)));

  const initialTags = new Map<number, { id: number; name: string }[]>();
  for (const row of taggingRows) {
    const list = initialTags.get(row.entityId) ?? [];
    list.push({ id: row.id, name: row.name });
    initialTags.set(row.entityId, list);
  }

  const tagRows = await db.select({ id: schema.tags.id, name: schema.tags.name }).from(schema.tags);
  const tagNames = new Map(tagRows.map((t) => [t.id, t.name]));

  const phaseRows = await db
    .select({ id: schema.projectPhases.id, name: schema.projectPhases.name })
    .from(schema.projectPhases)
    .where(eq(schema.projectPhases.projectId, opts.projectId));
  const phaseNames = new Map(phaseRows.map((p) => [p.id, p.name]));

  const attachments = collectAutoTagAttachments(active, tasks, initialTags, {
    tagNames,
    phaseNames,
  });
  for (const row of attachments) {
    await db
      .insert(schema.taggings)
      .values({
        tagId: row.tagId,
        entityType: "task",
        entityId: row.taskId,
      })
      .onConflictDoNothing();
  }
}

export async function applyTaskGroupAutoTagsForTask(
  db: Db,
  taskId: number,
): Promise<void> {
  const [task] = await db
    .select({ projectId: schema.tasks.projectId })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId));
  if (task?.projectId == null) return;
  await applyTaskGroupAutoTags(db, { projectId: task.projectId, taskId });
}
