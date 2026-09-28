import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { db as DbClient } from "../db/client.js";
import * as schema from "../db/schema.js";
import {
  resolveDerivedParent,
  resolveParentAfterChildChange,
  rollupFromChildren,
  type TodoRollup,
} from "../lib/todoHierarchy.js";
import { resolveTodoCheckToggle } from "../lib/todoProgress.js";
import { applyTodoProgressResult } from "./todoProgress.js";

type Db = typeof DbClient;

export type TodoHierarchyFields = {
  progressDerived: boolean;
  completeCount: number;
  childCount: number;
};

export async function loadChildStates(db: Db, parentId: number): Promise<{ state: string }[]> {
  return db
    .select({ state: schema.todos.state })
    .from(schema.todos)
    .where(eq(schema.todos.parentId, parentId));
}

export async function loadRollup(db: Db, parentId: number): Promise<TodoRollup> {
  return rollupFromChildren(await loadChildStates(db, parentId));
}

export async function hierarchyByTodoId(
  db: Db,
  todoIds: number[],
): Promise<Map<number, TodoHierarchyFields>> {
  const map = new Map<number, TodoHierarchyFields>();
  for (const id of todoIds) {
    map.set(id, { progressDerived: false, completeCount: 0, childCount: 0 });
  }
  if (todoIds.length === 0) return map;
  const kids = await db
    .select({ parentId: schema.todos.parentId, state: schema.todos.state })
    .from(schema.todos)
    .where(inArray(schema.todos.parentId, todoIds));
  const grouped = new Map<number, { state: string }[]>();
  for (const kid of kids) {
    if (kid.parentId == null) continue;
    const list = grouped.get(kid.parentId) ?? [];
    list.push({ state: kid.state });
    grouped.set(kid.parentId, list);
  }
  for (const id of todoIds) {
    const rollup = rollupFromChildren(grouped.get(id) ?? []);
    map.set(id, {
      progressDerived: rollup.derived,
      completeCount: rollup.completeCount,
      childCount: rollup.childCount,
    });
  }
  return map;
}

export async function listChildSummaries(db: Db, parentId: number) {
  return db
    .select({
      id: schema.todos.id,
      number: schema.todos.number,
      title: schema.todos.title,
      state: schema.todos.state,
      progress: schema.todos.progress,
    })
    .from(schema.todos)
    .where(and(eq(schema.todos.parentId, parentId), ne(schema.todos.state, "deleted")))
    .orderBy(asc(schema.todos.sortOrder), asc(schema.todos.id));
}

export async function wouldCreateTodoParentCycle(
  db: Db,
  todoId: number,
  candidateParentId: number | null,
): Promise<boolean> {
  if (candidateParentId == null) return false;
  if (candidateParentId === todoId) return true;
  let cursor: number | null = candidateParentId;
  const seen = new Set<number>();
  while (cursor != null) {
    if (cursor === todoId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const [row] = await db
      .select({ parentId: schema.todos.parentId })
      .from(schema.todos)
      .where(eq(schema.todos.id, cursor));
    cursor = row?.parentId ?? null;
  }
  return false;
}

export async function assertTodoParent(
  db: Db,
  todoId: number | null,
  projectId: number | null,
  parentId: number | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (parentId == null) return { ok: true };
  const [parent] = await db.select().from(schema.todos).where(eq(schema.todos.id, parentId));
  if (!parent) return { ok: false, message: "Parent ToDo not found" };
  if (parent.state === "deleted") {
    return { ok: false, message: "Cannot parent under a deleted ToDo" };
  }
  if (parent.projectId !== projectId) {
    return { ok: false, message: "Parent ToDo must share the same project (or both be unassigned)" };
  }
  if (todoId != null && (await wouldCreateTodoParentCycle(db, todoId, parentId))) {
    return { ok: false, message: "That parent would create a cycle" };
  }
  return { ok: true };
}

/** List checkbox. Parents with sub-items follow the rollup rules; leaves keep T0155. */
/** @returns true when list membership was already synced to the ToDo result. */
export async function applyTodoListCheck(
  db: Db,
  todoId: number,
  checked: boolean,
  actorId: number,
): Promise<boolean> {
  const [todo] = await db.select().from(schema.todos).where(eq(schema.todos.id, todoId));
  if (!todo || todo.state === "deleted") return false;
  const rollup = await loadRollup(db, todoId);
  const current = { state: todo.state, progress: todo.progress };
  const next = rollup.derived
    ? checked
      ? resolveDerivedParent(current, rollup, { state: "complete" })
      : todo.state === "complete"
        ? resolveDerivedParent(current, rollup, { state: "in_progress" })
        : null
    : resolveTodoCheckToggle(checked, current);
  if (!next) return false;
  await applyTodoProgressResult(db, todoId, actorId, next);
  await recomputeAncestorChain(db, todo.parentId, actorId);
  return next.membershipChecked != null;
}

/** Recompute a parent and, when its state changes, each ancestor above it. */
export async function recomputeAncestorChain(
  db: Db,
  startParentId: number | null,
  actorId: number,
): Promise<void> {
  let parentId = startParentId;
  const seen = new Set<number>();
  while (parentId != null && !seen.has(parentId)) {
    seen.add(parentId);
    const [row] = await db.select().from(schema.todos).where(eq(schema.todos.id, parentId));
    if (!row || row.state === "deleted") break;
    const nextParentId = row.parentId;
    const rollup = await loadRollup(db, row.id);
    const next = resolveParentAfterChildChange(
      { state: row.state, progress: row.progress },
      rollup,
    );
    if (!next) break;
    const stateChanged = next.state !== row.state;
    await applyTodoProgressResult(db, row.id, actorId, next);
    if (!stateChanged) break;
    parentId = nextParentId;
  }
}
