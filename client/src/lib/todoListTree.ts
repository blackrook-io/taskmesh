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

export const TODO_ROOT_DROP_ID = "todo-root";

const NEST_DROP_PREFIX = "nest:";

/** Middle band of a row. Outer edges stay sibling reorder. */
const ROW_EDGE = 0.28;

export type TodoDropZone = "before" | "center" | "after" | "root";

export type TodoDropAction =
  | { kind: "reorder"; orderedItemIds: number[] }
  | { kind: "reparent"; entityId: number; parentId: number | null; orderedItemIds: number[] }
  | { kind: "reject" }
  | { kind: "ignore" };

export function todoNestDropId(itemId: number): string {
  return `${NEST_DROP_PREFIX}${itemId}`;
}

export function parseTodoNestDropId(id: string): number | null {
  if (!id.startsWith(NEST_DROP_PREFIX)) return null;
  const value = Number(id.slice(NEST_DROP_PREFIX.length));
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Pointer Y inside a row rect: edges reorder, the middle reparents. */
export function todoDropZoneFromPointer(
  pointerY: number,
  top: number,
  height: number,
): Exclude<TodoDropZone, "root"> {
  if (!(height > 0)) return "center";
  const ratio = (pointerY - top) / height;
  if (ratio < ROW_EDGE) return "before";
  if (ratio > 1 - ROW_EDGE) return "after";
  return "center";
}

function canDragReparent(item: TodoListItem): boolean {
  return item.entityType === "todo" && !item.virtual && item.state !== "deleted";
}

function orderWithParent(
  items: TodoListItem[],
  activeItemId: number,
  parentEntityId: number | null,
): number[] {
  const stamped = items.map((item) =>
    item.id === activeItemId
      ? { ...item, parentId: parentEntityId, sortOrder: Number.MAX_SAFE_INTEGER }
      : item,
  );
  return flattenTodoList(stamped, null).map((row) => row.id);
}

function sameFlatOrder(items: TodoListItem[], orderedItemIds: number[]): boolean {
  const current = flattenTodoList(items, null).map((row) => row.id);
  return current.length === orderedItemIds.length && current.every((id, index) => id === orderedItemIds[index]);
}

/**
 * Middle of a ToDo reparents (the item becomes that parent's last child).
 * Edges reorder only inside the same sibling group. Root clears the parent
 * and places the item last among top-level rows.
 */
export function classifyTodoDrop(
  items: TodoListItem[],
  activeItemId: number,
  overItemId: number | "root",
  zone: TodoDropZone,
): TodoDropAction {
  const active = items.find((item) => item.id === activeItemId);
  if (!active || active.virtual) return { kind: "ignore" };

  if (zone === "root" || overItemId === "root") {
    if (!canDragReparent(active)) return { kind: "reject" };
    if (active.parentId == null) return { kind: "ignore" };
    return {
      kind: "reparent",
      entityId: active.entityId,
      parentId: null,
      orderedItemIds: orderWithParent(items, active.id, null),
    };
  }

  const over = items.find((item) => item.id === overItemId);
  if (!over || over.virtual) return { kind: "ignore" };

  if (zone === "before" || zone === "after") {
    const orderedItemIds = reorderTodoSiblings(items, active.id, over.id);
    if (!orderedItemIds || sameFlatOrder(items, orderedItemIds)) return { kind: "ignore" };
    return { kind: "reorder", orderedItemIds };
  }

  if (!canDragReparent(active) || !canDragReparent(over)) return { kind: "reject" };
  const members = items.filter((item) => item.entityType === "todo" && item.state !== "deleted");
  const blocked = blockedParentIds(
    members.map((item) => ({ entityId: item.entityId, parentId: item.parentId })),
    active.entityId,
  );
  if (blocked.has(over.entityId)) return { kind: "reject" };
  if (active.parentId === over.entityId) return { kind: "ignore" };
  return {
    kind: "reparent",
    entityId: active.entityId,
    parentId: over.entityId,
    orderedItemIds: orderWithParent(items, active.id, over.entityId),
  };
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
