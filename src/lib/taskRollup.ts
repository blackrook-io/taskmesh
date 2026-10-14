/** Derived parent status from descendant leaf tasks (T0335). */

export type RollupNode = {
  id: number;
  parentId: number | null;
  state: string;
  stateManual: boolean;
  rollupDone: number | null;
  rollupTotal: number | null;
};

export type RollupUpdate = {
  id: number;
  state: string;
  rollupDone: number | null;
  rollupTotal: number | null;
};

export function isDerivedTaskStatus(task: {
  stateManual: boolean;
  rollupTotal: number | null;
}): boolean {
  return !task.stateManual && task.rollupTotal != null;
}

/** True when a state write must be refused because status is derived. */
export function derivedStatePatchRejected(
  task: { stateManual: boolean; rollupTotal: number | null },
  patch: { state?: string; stateManual?: boolean },
): boolean {
  if (patch.state === undefined) return false;
  const nextManual = patch.stateManual ?? task.stateManual;
  return !nextManual && task.rollupTotal != null;
}

/**
 * Precedence: all Complete, any Blocked, any In Progress / Pending / Complete,
 * any On Hold, any Draft, otherwise Ready.
 */
export function derivedParentState(states: string[]): string {
  if (states.length === 0) {
    throw new Error("derivedParentState requires at least one leaf");
  }
  if (states.every((state) => state === "complete")) return "complete";
  if (states.some((state) => state === "blocked")) return "blocked";
  if (
    states.some(
      (state) => state === "in_progress" || state === "pending" || state === "complete",
    )
  ) {
    return "in_progress";
  }
  if (states.some((state) => state === "on_hold")) return "on_hold";
  if (states.some((state) => state === "new")) return "new";
  return "ready";
}

/** Non-deleted, non-canceled leaves under root. Empty when the task is not a derived parent. */
export function countedLeafStates(rootId: number, nodes: RollupNode[]): string[] {
  const byParent = new Map<number, RollupNode[]>();
  const byId = new Map<number, RollupNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
    if (node.parentId == null || node.state === "deleted") continue;
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }

  const states: string[] = [];
  const seen = new Set<number>();
  const walk = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const children = byParent.get(id) ?? [];
    if (children.length === 0) {
      const node = byId.get(id);
      if (
        node &&
        node.id !== rootId &&
        node.state !== "canceled" &&
        node.state !== "deleted"
      ) {
        states.push(node.state);
      }
      return;
    }
    for (const child of children) walk(child.id);
  };
  walk(rootId);
  return states;
}

export function nextRollup(node: RollupNode, nodes: RollupNode[]): RollupUpdate {
  const leaves = countedLeafStates(node.id, nodes);
  if (leaves.length === 0) {
    return { id: node.id, state: node.state, rollupDone: null, rollupTotal: null };
  }
  const done = leaves.filter((state) => state === "complete").length;
  return {
    id: node.id,
    state: node.stateManual ? node.state : derivedParentState(leaves),
    rollupDone: done,
    rollupTotal: leaves.length,
  };
}

/** Recompute each start task and its ancestors from the current tree. */
export function rollupUpdates(nodes: RollupNode[], startIds: number[]): RollupUpdate[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const affected = new Set<number>();
  for (const startId of startIds) {
    let cursor: number | null = startId;
    const seen = new Set<number>();
    while (cursor != null && !seen.has(cursor)) {
      seen.add(cursor);
      affected.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  const updates: RollupUpdate[] = [];
  for (const id of affected) {
    const node = byId.get(id);
    if (!node || node.state === "deleted") continue;
    const next = nextRollup(node, nodes);
    if (
      next.state !== node.state ||
      next.rollupDone !== node.rollupDone ||
      next.rollupTotal !== node.rollupTotal
    ) {
      updates.push(next);
    }
  }
  return updates;
}
