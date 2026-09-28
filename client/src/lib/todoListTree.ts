import type { TodoListItem } from "../types";

export type TodoTreeRow = TodoListItem & { depth: number };

function presentTodoIds(items: TodoListItem[]): Set<number> {
  return new Set(
    items
      .filter((item) => item.entityType === "todo" && item.state !== "deleted")
      .map((item) => item.entityId),
  );
}

/** Parent entity id when that parent is also a non-deleted member of this list. */
export function visibleParentId(
  item: TodoListItem,
  items: TodoListItem[],
  present: Set<number>,
): number | null {
  if (item.entityType !== "todo" || item.parentId == null || item.state === "deleted") return null;
  if (!present.has(item.parentId)) return null;
  const seen = new Set<number>([item.entityId]);
  let cursor: number | null = item.parentId;
  while (cursor != null && present.has(cursor)) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const parent = items.find((row) => row.entityType === "todo" && row.entityId === cursor);
    cursor = parent?.parentId ?? null;
  }
  return item.parentId;
}

function siblingKey(item: TodoListItem, items: TodoListItem[], present: Set<number>): string {
  const parentId = visibleParentId(item, items, present);
  return parentId == null ? "root" : `p:${parentId}`;
}

function sortGroup(
  rows: TodoListItem[],
  compare: ((a: TodoListItem, b: TodoListItem) => number) | null,
): TodoListItem[] {
  return [...rows].sort((a, b) => {
    if (compare) {
      const primary = compare(a, b);
      if (primary !== 0) return primary;
    }
    return a.sortOrder - b.sortOrder || a.id - b.id;
  });
}

/** Depth-first list. Children indent only when their parent is on the same list. */
export function flattenTodoList(
  items: TodoListItem[],
  compare: ((a: TodoListItem, b: TodoListItem) => number) | null,
): TodoTreeRow[] {
  const present = presentTodoIds(items);
  const groups = new Map<string, TodoListItem[]>();
  for (const item of items) {
    const key = siblingKey(item, items, present);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const out: TodoTreeRow[] = [];
  const seen = new Set<number>();
  const walk = (key: string, depth: number) => {
    for (const row of sortGroup(groups.get(key) ?? [], compare)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ ...row, depth });
      if (row.entityType === "todo" && row.state !== "deleted") {
        walk(`p:${row.entityId}`, depth + 1);
      }
    }
  };
  walk("root", 0);
  return out;
}

/**
 * Reorder within one sibling group. Returns every list item id in tree order,
 * or null when the drop would change parents.
 */
export function reorderTodoSiblings(
  items: TodoListItem[],
  activeId: number,
  overId: number,
): number[] | null {
  const present = presentTodoIds(items);
  const flat = flattenTodoList(items, null);
  const active = flat.find((row) => row.id === activeId);
  const over = flat.find((row) => row.id === overId);
  if (!active || !over) return null;
  if (siblingKey(active, items, present) !== siblingKey(over, items, present)) return null;
  const key = siblingKey(active, items, present);
  const siblings = flat.filter((row) => siblingKey(row, items, present) === key);
  const ids = siblings.map((row) => row.id);
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return null;
  ids.splice(from, 1);
  ids.splice(to, 0, activeId);
  const order = new Map(ids.map((id, index) => [id, index]));
  const next = items.map((item) =>
    order.has(item.id) ? { ...item, sortOrder: order.get(item.id) ?? item.sortOrder } : item,
  );
  return flattenTodoList(next, null).map((row) => row.id);
}

/** Entity ids that cannot be a parent of `todoId` (self and descendants). */
export function blockedParentIds(items: { entityId: number; parentId?: number | null }[], todoId: number): Set<number> {
  const children = new Map<number, number[]>();
  for (const item of items) {
    if (item.parentId == null) continue;
    const list = children.get(item.parentId) ?? [];
    list.push(item.entityId);
    children.set(item.parentId, list);
  }
  const blocked = new Set<number>([todoId]);
  const walk = (id: number) => {
    for (const childId of children.get(id) ?? []) {
      if (blocked.has(childId)) continue;
      blocked.add(childId);
      walk(childId);
    }
  };
  walk(todoId);
  return blocked;
}
