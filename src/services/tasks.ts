import { and, asc, eq, isNull, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { formatTaskNumber } from "../lib/taskFields.js";

type Db = NodePgDatabase<typeof schema>;

/** Next app-wide unique task number (max existing + 1, or 1). */
export async function allocateTaskNumber(db: Db): Promise<number> {
  const [row] = await db
    .select({ m: max(schema.tasks.number) })
    .from(schema.tasks);
  return (row?.m ?? 0) + 1;
}

/** Walk ancestors; return true if `candidateParentId` would create a cycle with `taskId`. */
export async function wouldCreateParentCycle(
  db: Db,
  taskId: number,
  candidateParentId: number | null,
): Promise<boolean> {
  if (candidateParentId == null) return false;
  if (candidateParentId === taskId) return true;
  let cursor: number | null = candidateParentId;
  const seen = new Set<number>();
  while (cursor != null) {
    if (cursor === taskId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const [row] = await db
      .select({ parentId: schema.tasks.parentId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, cursor));
    cursor = row?.parentId ?? null;
  }
  return false;
}

export async function assertParentCompatible(
  db: Db,
  taskProjectId: number | null,
  parentId: number | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (parentId == null) return { ok: true };
  const [parent] = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, parentId));
  if (!parent) {
    return { ok: false, message: "Parent task not found" };
  }
  if (parent.projectId !== taskProjectId) {
    return { ok: false, message: "Parent task must share the same project (or both be unassigned)" };
  }
  return { ok: true };
}

/** When a parent's phase changes, mirror to all descendants. */
export async function syncDescendantPhases(
  db: Db,
  parentId: number,
  phaseId: number | null,
): Promise<void> {
  const children = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(eq(schema.tasks.parentId, parentId));
  for (const child of children) {
    await db
      .update(schema.tasks)
      .set({ phaseId, updatedAt: new Date() })
      .where(eq(schema.tasks.id, child.id));
    await syncDescendantPhases(db, child.id, phaseId);
  }
}

const STATE_LABELS: Record<string, string> = {
  new: "New",
  in_progress: "In Progress",
  complete: "Complete",
  canceled: "Canceled",
  on_hold: "On Hold",
};

const PRIORITY_LABELS: Record<string, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/** Fields tracked in the task history change log. */
const TRACKED_FIELDS = [
  "title",
  "description",
  "state",
  "priority",
  "dueDate",
  "color",
  "phaseId",
  "parentId",
  "projectId",
] as const;

type TrackedField = (typeof TRACKED_FIELDS)[number];

type TaskLike = Pick<
  typeof schema.tasks.$inferSelect,
  TrackedField
>;

function clipText(value: string, max = 140): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

async function formatChangeValue(
  db: Db,
  field: TrackedField,
  value: unknown,
): Promise<string> {
  if (value == null || value === "") return "none";
  switch (field) {
    case "state":
      return STATE_LABELS[String(value)] ?? String(value);
    case "priority":
      return PRIORITY_LABELS[String(value)] ?? String(value);
    case "phaseId": {
      const [ph] = await db
        .select({ name: schema.projectPhases.name })
        .from(schema.projectPhases)
        .where(eq(schema.projectPhases.id, Number(value)));
      return ph?.name ?? `#${String(value)}`;
    }
    case "projectId": {
      const [proj] = await db
        .select({ name: schema.projects.name })
        .from(schema.projects)
        .where(eq(schema.projects.id, Number(value)));
      return proj?.name ?? `#${String(value)}`;
    }
    case "parentId": {
      const [parent] = await db
        .select({ number: schema.tasks.number })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, Number(value)));
      return parent ? formatTaskNumber(parent.number) : `#${String(value)}`;
    }
    case "description":
    case "title":
    case "color":
      return clipText(String(value));
    default:
      return String(value);
  }
}

/**
 * Diff a task's tracked fields before/after an update and append one
 * `kind:"change"` row per changed field to the task history timeline.
 */
export async function recordTaskChanges(
  db: Db,
  taskId: number,
  before: TaskLike,
  after: TaskLike,
): Promise<void> {
  const rows: (typeof schema.taskActivity.$inferInsert)[] = [];
  for (const field of TRACKED_FIELDS) {
    const bv = before[field] ?? null;
    const av = after[field] ?? null;
    if (bv === av) continue;
    rows.push({
      taskId,
      kind: "change",
      field,
      oldValue: await formatChangeValue(db, field, bv),
      newValue: await formatChangeValue(db, field, av),
    });
  }
  if (rows.length === 0) return;
  await db.insert(schema.taskActivity).values(rows);
}

/** Next sortOrder among siblings (same project + parent). */
export async function nextSiblingSortOrder(
  db: Db,
  projectId: number | null,
  parentId: number | null,
): Promise<number> {
  const rows = await db
    .select({ m: schema.tasks.sortOrder })
    .from(schema.tasks)
    .where(
      and(
        projectId == null ? isNull(schema.tasks.projectId) : eq(schema.tasks.projectId, projectId),
        parentId == null ? isNull(schema.tasks.parentId) : eq(schema.tasks.parentId, parentId),
      ),
    )
    .orderBy(asc(schema.tasks.sortOrder));
  return rows.length ? Math.max(...rows.map((r) => r.m)) + 1 : 0;
}
