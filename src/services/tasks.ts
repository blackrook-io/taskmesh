import { and, asc, eq, isNull, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

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
