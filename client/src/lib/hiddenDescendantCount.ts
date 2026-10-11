/** Descendants the list walk would emit if this parent were expanded. Collapse flags are ignored. */
export function hiddenDescendantCount(
  parentId: number,
  childrenOf: (id: number) => readonly { id: number }[],
  cache: Map<number, number> = new Map(),
): number {
  const visiting = new Set<number>();

  const countFrom = (id: number): number => {
    const hit = cache.get(id);
    if (hit != null) return hit;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let total = 0;
    for (const child of childrenOf(id)) {
      total += 1 + countFrom(child.id);
    }
    visiting.delete(id);
    cache.set(id, total);
    return total;
  };

  return countFrom(parentId);
}
