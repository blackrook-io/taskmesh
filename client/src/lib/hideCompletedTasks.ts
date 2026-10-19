export type ClosedHideCounts = {
  completed: number;
  canceled: number;
};

type HideNode = {
  id: number;
  state: string;
};

/** States the Hide completed toggle removes from task lists. */
export function isListHideState(state: string): boolean {
  return state === "complete" || state === "canceled";
}

/**
 * True when this task should be omitted: it is a Complete or Canceled leaf,
 * or every descendant `childrenOf` returns is itself a hidden closed subtree.
 * An open task with an open descendant stays visible.
 */
export function isHiddenClosedSubtree(
  task: HideNode,
  childrenOf: (id: number) => readonly HideNode[],
  cache: Map<number, boolean> = new Map(),
  visiting: Set<number> = new Set(),
): boolean {
  const hit = cache.get(task.id);
  if (hit != null) return hit;
  if (visiting.has(task.id)) return false;
  visiting.add(task.id);
  const kids = childrenOf(task.id);
  const hidden =
    kids.length === 0
      ? isListHideState(task.state)
      : kids.every((child) => isHiddenClosedSubtree(child, childrenOf, cache, visiting));
  visiting.delete(task.id);
  cache.set(task.id, hidden);
  return hidden;
}

function addNode(counts: ClosedHideCounts, state: string) {
  if (state === "complete") counts.completed += 1;
  else if (state === "canceled") counts.canceled += 1;
}

/** Complete and Canceled descendants the hide walk would omit under `taskId`. */
export function hiddenClosedCounts(
  taskId: number,
  childrenOf: (id: number) => readonly HideNode[],
  cache: Map<number, boolean> = new Map(),
): ClosedHideCounts {
  const counts: ClosedHideCounts = { completed: 0, canceled: 0 };
  const tally = (node: HideNode, seen: Set<number>) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    addNode(counts, node.state);
    for (const child of childrenOf(node.id)) tally(child, seen);
  };
  for (const child of childrenOf(taskId)) {
    if (isHiddenClosedSubtree(child, childrenOf, cache)) {
      tally(child, new Set());
    } else {
      const nested = hiddenClosedCounts(child.id, childrenOf, cache);
      counts.completed += nested.completed;
      counts.canceled += nested.canceled;
    }
  }
  return counts;
}

/** Progress meter title, with a hidden-closed suffix when those counts are non-zero. */
export function rollupMeterTitle(
  done: number,
  total: number,
  hidden?: ClosedHideCounts | null,
): string {
  const base = `${done} of ${total} complete`;
  if (!hidden) return base;
  const parts: string[] = [];
  if (hidden.completed > 0) parts.push(`${hidden.completed} Completed`);
  if (hidden.canceled > 0) parts.push(`${hidden.canceled} Canceled`);
  if (parts.length === 0) return base;
  return `${base}. Hidden: ${parts.join(", ")}`;
}
