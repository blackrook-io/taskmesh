import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  type UniqueIdentifier,
} from "@dnd-kit/core";

export type GroupKey = number | "none";

export type DndPlacement = "start" | "end" | "before-task";

export type DndItemData = {
  type?: string;
  taskId?: number;
  parentId?: number | null;
  groupKey?: GroupKey;
  groupId?: number | null;
};

export type OverTarget = {
  groupKey: GroupKey;
  placement: DndPlacement;
  taskId?: number;
  parentId?: number | null;
};

function arrayMove<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice();
  const [removed] = next.splice(from, 1);
  if (removed === undefined) return items;
  next.splice(to, 0, removed);
  return next;
}

export function parseSortableId(id: UniqueIdentifier): DndItemData | null {
  const s = String(id);
  if (s.startsWith("drop-group-")) {
    const rest = s.slice("drop-group-".length);
    const groupId = rest === "none" ? null : Number(rest);
    if (rest !== "none" && !Number.isFinite(groupId)) return null;
    return { type: "group-drop", groupId };
  }
  if (s.startsWith("group-")) {
    const rest = s.slice("group-".length);
    const groupId = rest === "none" ? null : Number(rest);
    if (rest !== "none" && !Number.isFinite(groupId)) return null;
    return { type: "group", groupId };
  }
  if (s.startsWith("task-")) {
    const rest = s.slice("task-".length);
    const lastDash = rest.lastIndexOf("-");
    if (lastDash < 0) return null;
    const groupPart = rest.slice(0, lastDash);
    const taskId = Number(rest.slice(lastDash + 1));
    if (!Number.isFinite(taskId)) return null;
    const groupKey: GroupKey = groupPart === "none" ? "none" : Number(groupPart);
    if (groupKey !== "none" && !Number.isFinite(groupKey)) return null;
    return { type: "task", taskId, groupKey };
  }
  return null;
}

export function resolveOverTarget(
  data: DndItemData | undefined,
  overId: UniqueIdentifier,
): OverTarget | null {
  const parsed = data?.type ? data : (parseSortableId(overId) ?? undefined);
  if (!parsed?.type) return null;
  if (parsed.type === "task" && parsed.taskId != null && parsed.groupKey != null) {
    return {
      groupKey: parsed.groupKey,
      placement: "before-task",
      taskId: parsed.taskId,
      parentId: parsed.parentId,
    };
  }
  if (parsed.type === "group") {
    return { groupKey: parsed.groupId ?? "none", placement: "start" };
  }
  if (parsed.type === "group-drop") {
    return { groupKey: parsed.groupId ?? "none", placement: "end" };
  }
  return null;
}

/** Walk parents until a task id that is a section root. */
export function ancestorInSection(
  taskId: number,
  parentIdOf: (id: number) => number | null | undefined,
  sectionRootIds: number[],
): number | null {
  const roots = new Set(sectionRootIds);
  let id: number | null = taskId;
  const seen = new Set<number>();
  while (id != null && !seen.has(id)) {
    if (roots.has(id)) return id;
    seen.add(id);
    const parent = parentIdOf(id);
    id = parent ?? null;
  }
  return null;
}

/** Same-section sortable move. Returns null when order would not change. */
export function reorderSectionRoots(opts: {
  sectionRootIds: number[];
  draggedId: number;
  overTaskId: number | null;
  placement: DndPlacement;
}): number[] | null {
  const { sectionRootIds, draggedId, overTaskId, placement } = opts;
  const from = sectionRootIds.indexOf(draggedId);
  if (from < 0) return null;
  let to: number;
  if (placement === "start") to = 0;
  else if (placement === "end") to = Math.max(0, sectionRootIds.length - 1);
  else {
    if (overTaskId == null) return null;
    to = sectionRootIds.indexOf(overTaskId);
    if (to < 0) return null;
  }
  if (from === to) return null;
  return arrayMove(sectionRootIds, from, to);
}

/** Insert a task into another section's root order (cross-group drop). */
export function insertDraggedIntoSection(opts: {
  sectionRootIds: number[];
  draggedId: number;
  overTaskId: number | null;
  placement: DndPlacement;
}): number[] {
  const without = opts.sectionRootIds.filter((id) => id !== opts.draggedId);
  let insertAt = without.length;
  if (opts.placement === "start") insertAt = 0;
  else if (opts.placement === "end") insertAt = without.length;
  else if (opts.overTaskId != null) {
    const idx = without.indexOf(opts.overTaskId);
    if (idx >= 0) insertAt = idx;
  }
  return [...without.slice(0, insertAt), opts.draggedId, ...without.slice(insertAt)];
}

/** Task drags: prefer rows / section drop zones — never group headers (avoids
 *  snapping to the next group while the gap opens at the end of the previous). */
export const taskBoardCollisionDetection: CollisionDetection = (args) => {
  const activeType = (args.active.data.current as DndItemData | undefined)?.type;
  if (activeType === "group") {
    const groupContainers = args.droppableContainers.filter((c) => {
      const id = String(c.id);
      return id.startsWith("group-") && id !== "group-none";
    });
    return closestCenter({ ...args, droppableContainers: groupContainers });
  }

  const taskDropContainers = args.droppableContainers.filter((c) => {
    const id = String(c.id);
    return id.startsWith("task-") || id.startsWith("drop-group-");
  });
  const scoped = { ...args, droppableContainers: taskDropContainers };

  const pointerHits = pointerWithin(scoped);
  const prefer = (pred: (id: string) => boolean) =>
    pointerHits.filter((hit) => pred(String(hit.id)));

  if (pointerHits.length > 0) {
    const tasks = prefer((id) => id.startsWith("task-"));
    if (tasks.length) return tasks;
    const drops = prefer((id) => id.startsWith("drop-group-"));
    if (drops.length) return drops;
    return pointerHits;
  }

  return closestCenter(scoped);
};
