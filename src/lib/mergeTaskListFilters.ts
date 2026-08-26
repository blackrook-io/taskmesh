/**
 * List ↔ Task Group filter cascade (T0088).
 * Dependency-free so client can mirror the same algorithm and tests can import it.
 *
 * Rule: list filter is the base; group filter is ANDed on. If the group names a field,
 * all list clauses on that field are dropped for that group (field-level override).
 * Effective match: match(listRemainder) && match(group) — not flat concatenation
 * (group OR joins would change meaning if spliced into one left-to-right chain).
 */

export type MergeFilterClause = {
  field: string;
  operator: string;
  value: string;
};

export type MergeTaskListFilter = {
  clauses: MergeFilterClause[];
  joins: string[];
};

export function emptyMergeFilter(): MergeTaskListFilter {
  return { clauses: [], joins: [] };
}

/** Fields present in any clause of `filter`. */
export function fieldsInFilter(filter: MergeTaskListFilter): Set<string> {
  return new Set(filter.clauses.map((c) => c.field));
}

/**
 * Drop clauses whose field is in `fields`. Joins between remaining clauses:
 * for consecutive kept indices i < j, use joins[j - 1] (join immediately before the right clause).
 */
export function stripFilterFields(
  filter: MergeTaskListFilter,
  fields: ReadonlySet<string>,
): MergeTaskListFilter {
  if (filter.clauses.length === 0 || fields.size === 0) {
    return {
      clauses: filter.clauses.map((c) => ({ ...c })),
      joins: [...filter.joins],
    };
  }

  const keptIndices: number[] = [];
  for (let i = 0; i < filter.clauses.length; i++) {
    if (!fields.has(filter.clauses[i]!.field)) keptIndices.push(i);
  }

  const clauses = keptIndices.map((i) => ({ ...filter.clauses[i]! }));
  const joins: string[] = [];
  for (let k = 1; k < keptIndices.length; k++) {
    const right = keptIndices[k]!;
    joins.push(filter.joins[right - 1] ?? "and");
  }
  return { clauses, joins };
}

/**
 * Prepare the cascade: list remainder (overridden fields stripped) + the group filter.
 * Callers evaluate `match(listRemainder) && match(group)`.
 */
export function mergeListAndGroupFilter(
  list: MergeTaskListFilter,
  group: MergeTaskListFilter,
): { listRemainder: MergeTaskListFilter; group: MergeTaskListFilter } {
  const overridden = fieldsInFilter(group);
  return {
    listRemainder: stripFilterFields(list, overridden),
    group: {
      clauses: group.clauses.map((c) => ({ ...c })),
      joins: [...group.joins],
    },
  };
}
