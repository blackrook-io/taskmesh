import { and, eq, inArray, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { formatEntityRef } from "../lib/entityRef.js";

type Db = NodePgDatabase<typeof schema>;

export type PlanEntityType = "task" | "todo";

export type PlanItemRef = {
  entityType: PlanEntityType;
  entityId: number;
};

/** One task or to-do as it sits in one plan. `parent` is set only when that parent is in the same plan. */
export type PlanLayoutItem = PlanItemRef & {
  number?: number;
  phaseSort: number;
  itemSort: number;
  parent: PlanItemRef | null;
  state: string;
  estimateHours: number | null;
  /** ToDo progress 0–100. Tasks ignore it. */
  progress?: number;
};

export type PlanDependencyEdge = {
  prerequisite: PlanItemRef;
  dependent: PlanItemRef;
};

export type PlanOrderViolation = {
  kind: "dependency" | "enclosure" | "cycle";
  message: string;
  prerequisite?: PlanItemRef;
  dependent?: PlanItemRef;
};

export type PlanRollupSlice = {
  hoursTotal: number;
  hoursDone: number;
  /** 0–1. Hours-weighted when any counted hours exist, otherwise fully-done items ÷ items. */
  progress: number;
  progressMode: "hours" | "count";
  itemCount: number;
  itemsDone: number;
  unestimatedCount: number;
};

export type PlanRollup = {
  plan: PlanRollupSlice;
  phases: Array<{ phaseSort: number } & PlanRollupSlice>;
};

export type PlanFixPreview = {
  phases: Array<{ phaseSort: number; items: PlanItemRef[]; changed: boolean }>;
  conflicts: PlanOrderViolation[];
};

export type PlanSnapshot = {
  id: number;
  number: number;
  title: string;
  items: PlanLayoutItem[];
  dependencies: PlanDependencyEdge[];
};

export type PlanOrderConflict = {
  id: number;
  number: number;
  title: string;
  violations: PlanOrderViolation[];
};

export type PlanRuleDetails = {
  plans?: Array<{ id: number; number: number; title: string }>;
  violations?: PlanOrderViolation[];
  addAndMove?: { planId: number };
};

export class PlanRuleError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: PlanRuleDetails;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: PlanRuleDetails,
  ) {
    super(message);
    this.name = "PlanRuleError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const EXCLUDED_STATES = new Set(["canceled", "deleted"]);

export function itemKey(ref: PlanItemRef): string {
  return `${ref.entityType}:${ref.entityId}`;
}

function sameRef(a: PlanItemRef, b: PlanItemRef): boolean {
  return a.entityType === b.entityType && a.entityId === b.entityId;
}

function orderedItems(items: PlanLayoutItem[]): PlanLayoutItem[] {
  return [...items].sort((a, b) => {
    if (a.phaseSort !== b.phaseSort) return a.phaseSort - b.phaseSort;
    if (a.itemSort !== b.itemSort) return a.itemSort - b.itemSort;
    return itemKey(a).localeCompare(itemKey(b));
  });
}

function labelOf(ref: PlanItemRef, byKey: Map<string, PlanLayoutItem>): string {
  const item = byKey.get(itemKey(ref));
  if (item?.number != null) return formatEntityRef(item.entityType, item.number);
  return itemKey(ref);
}

function refOf(item: PlanLayoutItem): PlanItemRef {
  return { entityType: item.entityType, entityId: item.entityId };
}

/** Direct in-plan children, keyed by parent. Parents missing from `items` are ignored. */
function childKeys(items: PlanLayoutItem[]): Map<string, string[]> {
  const present = new Set(items.map(itemKey));
  const order = new Map(orderedItems(items).map((item, index) => [itemKey(item), index]));
  const map = new Map<string, string[]>();
  for (const item of items) {
    if (!item.parent) continue;
    const parentKey = itemKey(item.parent);
    if (!present.has(parentKey)) continue;
    const list = map.get(parentKey) ?? [];
    list.push(itemKey(item));
    map.set(parentKey, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }
  return map;
}

function descendantKeys(root: string, children: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  const stack = [...(children.get(root) ?? [])];
  while (stack.length > 0) {
    const key = stack.pop();
    if (key == null || out.has(key)) continue;
    out.add(key);
    stack.push(...(children.get(key) ?? []));
  }
  return out;
}

function dedupeEdges(edges: Array<[string, string]>): Array<[string, string]> {
  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const [from, to] of edges) {
    if (from === to) continue;
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([from, to]);
  }
  return out;
}

/** Prerequisite before dependent, plus same-phase parent before child. */
function precedenceEdges(
  items: PlanLayoutItem[],
  dependencies: PlanDependencyEdge[],
): Array<[string, string]> {
  const byKey = new Map(items.map((item) => [itemKey(item), item]));
  const edges: Array<[string, string]> = [];
  for (const edge of dependencies) {
    const from = itemKey(edge.prerequisite);
    const to = itemKey(edge.dependent);
    if (byKey.has(from) && byKey.has(to)) edges.push([from, to]);
  }
  const children = childKeys(items);
  for (const [parentKey, kids] of children) {
    const parent = byKey.get(parentKey);
    if (!parent) continue;
    for (const kidKey of kids) {
      const kid = byKey.get(kidKey);
      if (kid && kid.phaseSort === parent.phaseSort) edges.push([parentKey, kidKey]);
    }
  }
  return dedupeEdges(edges);
}

function kahn(
  nodes: string[],
  edges: Array<[string, string]>,
  tiebreak: Map<string, number>,
): { order: string[]; leftover: string[] } {
  const indegree = new Map(nodes.map((node) => [node, 0]));
  const outgoing = new Map<string, string[]>(nodes.map((node) => [node, []]));
  for (const [from, to] of edges) {
    if (!indegree.has(from) || !indegree.has(to)) continue;
    outgoing.get(from)?.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }
  const ready = nodes.filter((node) => indegree.get(node) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort(
      (a, b) => (tiebreak.get(a) ?? 0) - (tiebreak.get(b) ?? 0) || a.localeCompare(b),
    );
    const next = ready.shift();
    if (next == null) break;
    order.push(next);
    for (const to of outgoing.get(next) ?? []) {
      const degree = (indegree.get(to) ?? 1) - 1;
      indegree.set(to, degree);
      if (degree === 0) ready.push(to);
    }
  }
  const emitted = new Set(order);
  return { order, leftover: nodes.filter((node) => !emitted.has(node)) };
}

function dependencyViolation(
  dependent: PlanItemRef,
  prerequisite: PlanItemRef,
  byKey: Map<string, PlanLayoutItem>,
): PlanOrderViolation {
  return {
    kind: "dependency",
    message: `${labelOf(dependent, byKey)} depends on ${labelOf(prerequisite, byKey)}`,
    prerequisite,
    dependent,
  };
}

function enclosureViolation(
  parent: PlanItemRef,
  child: PlanItemRef,
  byKey: Map<string, PlanLayoutItem>,
): PlanOrderViolation {
  return {
    kind: "enclosure",
    message: `${labelOf(child, byKey)} must stay in ${labelOf(parent, byKey)}'s block`,
    prerequisite: parent,
    dependent: child,
  };
}

function cycleViolation(members: string[], byKey: Map<string, PlanLayoutItem>): PlanOrderViolation {
  const labels = [...members]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => labelOf(parseKey(key), byKey));
  return { kind: "cycle", message: `Cycle among ${labels.join(", ")}` };
}

function parseKey(key: string): PlanItemRef {
  const split = key.indexOf(":");
  const entityType = key.slice(0, split) === "todo" ? "todo" : "task";
  return { entityType, entityId: Number(key.slice(split + 1)) };
}

/**
 * Prerequisites sit strictly above dependents. An in-plan parent encloses its
 * in-plan children as one contiguous block in the same phase.
 * Edges with an end outside the layout are ignored.
 */
export function validatePlanOrder(
  items: PlanLayoutItem[],
  dependencies: PlanDependencyEdge[],
): PlanOrderViolation[] {
  const ordered = orderedItems(items);
  const byKey = new Map(ordered.map((item) => [itemKey(item), item]));
  const index = new Map(ordered.map((item, position) => [itemKey(item), position]));
  const violations: PlanOrderViolation[] = [];

  for (const edge of dependencies) {
    const from = index.get(itemKey(edge.prerequisite));
    const to = index.get(itemKey(edge.dependent));
    if (from == null || to == null) continue;
    if (from >= to) violations.push(dependencyViolation(edge.dependent, edge.prerequisite, byKey));
  }

  const children = childKeys(ordered);
  for (const [parentKey, kids] of children) {
    const parent = byKey.get(parentKey);
    if (!parent) continue;
    const descendantList = [...descendantKeys(parentKey, children)].flatMap((key) => {
      const item = byKey.get(key);
      return item ? [item] : [];
    });
    const otherPhase = descendantList.filter((item) => item.phaseSort !== parent.phaseSort);
    if (otherPhase.length > 0) {
      for (const child of otherPhase) {
        violations.push(enclosureViolation(refOf(parent), refOf(child), byKey));
      }
      continue;
    }
    const memberIndexes = [parent, ...descendantList].map((item) => index.get(itemKey(item)) ?? 0);
    const min = Math.min(...memberIndexes);
    const max = Math.max(...memberIndexes);
    const parentIndex = index.get(parentKey) ?? 0;
    if (parentIndex !== min || max - min + 1 !== memberIndexes.length) {
      for (const child of kids) {
        const childItem = byKey.get(child);
        if (childItem) violations.push(enclosureViolation(refOf(parent), refOf(childItem), byKey));
      }
    }
  }

  const nodes = ordered.map(itemKey);
  const { leftover } = kahn(nodes, precedenceEdges(ordered, dependencies), index);
  if (leftover.length > 0) violations.push(cycleViolation(leftover, byKey));
  return violations;
}

function counted(item: PlanLayoutItem): boolean {
  return !EXCLUDED_STATES.has(item.state);
}

function doneFraction(item: PlanLayoutItem): number {
  if (item.state === "complete" || item.state === "pending") return 1;
  if (item.entityType === "todo") {
    const progress = item.progress ?? 0;
    return Math.min(100, Math.max(0, progress)) / 100;
  }
  return 0;
}

function rollupSlice(leaves: PlanLayoutItem[]): PlanRollupSlice {
  let hoursTotal = 0;
  let hoursDone = 0;
  let unestimatedCount = 0;
  let itemsDone = 0;
  for (const item of leaves) {
    if (doneFraction(item) === 1) itemsDone += 1;
    if (item.estimateHours == null) {
      unestimatedCount += 1;
      continue;
    }
    hoursTotal += item.estimateHours;
    hoursDone += item.estimateHours * doneFraction(item);
  }
  const itemCount = leaves.length;
  if (hoursTotal > 0) {
    return {
      hoursTotal,
      hoursDone,
      progress: hoursDone / hoursTotal,
      progressMode: "hours",
      itemCount,
      itemsDone,
      unestimatedCount,
    };
  }
  return {
    hoursTotal,
    hoursDone,
    progress: itemCount === 0 ? 0 : itemsDone / itemCount,
    progressMode: "count",
    itemCount,
    itemsDone,
    unestimatedCount,
  };
}

/**
 * Effort-weighted rollup. A parent's own hours count only when it has no
 * counted in-plan child. Canceled and deleted rows drop out of every total.
 */
export function computePlanRollup(items: PlanLayoutItem[]): PlanRollup {
  const children = childKeys(items);
  const leaves = items.filter((item) => {
    if (!counted(item)) return false;
    const kids = children.get(itemKey(item)) ?? [];
    return !kids.some((key) => {
      const child = items.find((candidate) => itemKey(candidate) === key);
      return child != null && counted(child);
    });
  });
  const phaseSorts: number[] = [];
  for (const item of orderedItems(items)) {
    if (!phaseSorts.includes(item.phaseSort)) phaseSorts.push(item.phaseSort);
  }
  return {
    plan: rollupSlice(leaves),
    phases: phaseSorts.map((phaseSort) => ({
      phaseSort,
      ...rollupSlice(leaves.filter((item) => item.phaseSort === phaseSort)),
    })),
  };
}

function phaseEdges(
  phaseItems: PlanLayoutItem[],
  dependencies: PlanDependencyEdge[],
): Array<[string, string]> {
  const keys = new Set(phaseItems.map(itemKey));
  const children = childKeys(phaseItems);
  const edges: Array<[string, string]> = [];
  for (const edge of dependencies) {
    const from = itemKey(edge.prerequisite);
    const to = itemKey(edge.dependent);
    if (keys.has(from) && keys.has(to)) edges.push([from, to]);
  }
  for (const [parentKey, kids] of children) {
    for (const kid of kids) edges.push([parentKey, kid]);
  }
  for (const parentKey of children.keys()) {
    const closure = descendantKeys(parentKey, children);
    closure.add(parentKey);
    for (const edge of dependencies) {
      const prereq = itemKey(edge.prerequisite);
      const dependent = itemKey(edge.dependent);
      if (!closure.has(dependent) || closure.has(prereq) || !keys.has(prereq)) continue;
      edges.push([prereq, parentKey]);
    }
  }
  return dedupeEdges(edges);
}

function packBlocks(order: string[], children: Map<string, string[]>): string[] {
  const position = new Map(order.map((key, index) => [key, index]));
  const nested = new Set<string>();
  for (const kids of children.values()) {
    for (const kid of kids) nested.add(kid);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  const emit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
    const kids = [...(children.get(key) ?? [])].sort(
      (a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0),
    );
    for (const kid of kids) emit(kid);
  };
  for (const key of order) {
    if (!nested.has(key)) emit(key);
  }
  for (const key of order) emit(key);
  return out;
}

/**
 * Stable topological preview inside each phase (current index breaks ties).
 * Does not move items across phases. Cross-phase conflicts and cycles are listed
 * and that phase is left unchanged.
 */
export function previewFixOrder(
  items: PlanLayoutItem[],
  dependencies: PlanDependencyEdge[],
): PlanFixPreview {
  const ordered = orderedItems(items);
  const byKey = new Map(ordered.map((item) => [itemKey(item), item]));
  const conflicts: PlanOrderViolation[] = [];
  const fullChildren = childKeys(ordered);

  for (const edge of dependencies) {
    const prereq = byKey.get(itemKey(edge.prerequisite));
    const dependent = byKey.get(itemKey(edge.dependent));
    if (!prereq || !dependent || prereq.phaseSort <= dependent.phaseSort) continue;
    conflicts.push(dependencyViolation(refOf(dependent), refOf(prereq), byKey));
  }
  for (const [parentKey, kids] of fullChildren) {
    const parent = byKey.get(parentKey);
    if (!parent) continue;
    for (const kidKey of kids) {
      const kid = byKey.get(kidKey);
      if (kid && kid.phaseSort !== parent.phaseSort) {
        conflicts.push(enclosureViolation(refOf(parent), refOf(kid), byKey));
      }
    }
  }

  const phaseSorts: number[] = [];
  for (const item of ordered) {
    if (!phaseSorts.includes(item.phaseSort)) phaseSorts.push(item.phaseSort);
  }

  const phases = phaseSorts.map((phaseSort) => {
    const phaseItems = ordered.filter((item) => item.phaseSort === phaseSort);
    const current = phaseItems.map(itemKey);
    const tiebreak = new Map(current.map((key, index) => [key, index]));
    const children = childKeys(phaseItems);
    const { order, leftover } = kahn(current, phaseEdges(phaseItems, dependencies), tiebreak);
    if (leftover.length > 0) {
      conflicts.push(cycleViolation(leftover, byKey));
      return {
        phaseSort,
        items: phaseItems.map(refOf),
        changed: false,
      };
    }
    const packed = packBlocks(order, children);
    return {
      phaseSort,
      items: packed.map(parseKey),
      changed: packed.join("|") !== current.join("|"),
    };
  });

  return { phases, conflicts };
}

export function assertPlanRevision(current: number, submitted: number): void {
  if (current !== submitted) {
    throw new PlanRuleError(
      409,
      "plan_revision_stale",
      "Plan revision is stale; refresh and try again",
    );
  }
}

function containsItem(items: PlanLayoutItem[], ref: PlanItemRef): boolean {
  return items.some((item) => sameRef(item, ref));
}

function violationKey(violation: PlanOrderViolation): string {
  const prerequisite = violation.prerequisite ? itemKey(violation.prerequisite) : "";
  const dependent = violation.dependent ? itemKey(violation.dependent) : "";
  return `${violation.kind}|${prerequisite}|${dependent}|${violation.message}`;
}

function addedDependencyViolations(
  items: PlanLayoutItem[],
  dependencies: PlanDependencyEdge[],
  edge: PlanDependencyEdge,
): PlanOrderViolation[] {
  if (!containsItem(items, edge.prerequisite) || !containsItem(items, edge.dependent)) return [];
  const ordered = orderedItems(items);
  const byKey = new Map(ordered.map((item) => [itemKey(item), item]));
  const index = new Map(ordered.map((item, position) => [itemKey(item), position]));
  const from = index.get(itemKey(edge.prerequisite)) ?? 0;
  const to = index.get(itemKey(edge.dependent)) ?? 0;
  const violations: PlanOrderViolation[] = [];
  if (from >= to) violations.push(dependencyViolation(edge.dependent, edge.prerequisite, byKey));
  const { leftover } = kahn(
    ordered.map(itemKey),
    precedenceEdges(ordered, [...dependencies, edge]),
    index,
  );
  if (leftover.includes(itemKey(edge.prerequisite)) && leftover.includes(itemKey(edge.dependent))) {
    violations.push(cycleViolation(leftover, byKey));
  }
  return violations;
}

/**
 * Place `child` and its in-plan descendants at the end of `nextParent`'s block,
 * in the parent's phase. Returns null when the parent sits inside that closure.
 */
function layoutAfterParentChange(
  items: PlanLayoutItem[],
  child: PlanItemRef,
  nextParent: PlanItemRef,
): PlanLayoutItem[] | null {
  const ordered = orderedItems(items);
  const children = childKeys(ordered);
  const childKey = itemKey(child);
  const parentKey = itemKey(nextParent);
  if (!ordered.some((item) => itemKey(item) === childKey)) return ordered;
  if (!ordered.some((item) => itemKey(item) === parentKey)) return ordered;
  const moved = descendantKeys(childKey, children);
  moved.add(childKey);
  if (moved.has(parentKey)) return null;

  const staying = ordered.filter((item) => !moved.has(itemKey(item)));
  const stayingChildren = childKeys(staying);
  const parentDescendants = descendantKeys(parentKey, stayingChildren);
  const insertAfter = staying.reduce((end, item, position) => {
    const key = itemKey(item);
    if (key === parentKey || parentDescendants.has(key)) return position;
    return end;
  }, staying.findIndex((item) => itemKey(item) === parentKey));

  const parent = staying.find((item) => itemKey(item) === parentKey);
  const movedItems = ordered
    .filter((item) => moved.has(itemKey(item)))
    .map((item) => ({
      ...item,
      phaseSort: parent?.phaseSort ?? item.phaseSort,
      parent: itemKey(item) === childKey ? { ...nextParent } : item.parent,
    }));
  const next = [
    ...staying.slice(0, insertAfter + 1),
    ...movedItems,
    ...staying.slice(insertAfter + 1),
  ];
  const counts = new Map<number, number>();
  return next.map((item) => {
    const sort = counts.get(item.phaseSort) ?? 0;
    counts.set(item.phaseSort, sort + 1);
    return { ...item, itemSort: sort };
  });
}

export function conflictsForNewDependency(
  plans: PlanSnapshot[],
  edge: PlanDependencyEdge,
): PlanOrderConflict[] {
  const conflicts: PlanOrderConflict[] = [];
  for (const plan of plans) {
    const violations = addedDependencyViolations(plan.items, plan.dependencies, edge);
    if (violations.length === 0) continue;
    conflicts.push({
      id: plan.id,
      number: plan.number,
      title: plan.title,
      violations,
    });
  }
  return conflicts;
}

/** Keep the caller's order inside each phase. Do not re-sort by the old itemSort. */
function renumberLayout(items: PlanLayoutItem[]): PlanLayoutItem[] {
  const phases = new Map<number, PlanLayoutItem[]>();
  for (const item of items) {
    const list = phases.get(item.phaseSort) ?? [];
    list.push(item);
    phases.set(item.phaseSort, list);
  }
  const out: PlanLayoutItem[] = [];
  for (const phaseSort of [...phases.keys()].sort((a, b) => a - b)) {
    const list = phases.get(phaseSort) ?? [];
    list.forEach((item, itemSort) => {
      out.push({ ...item, itemSort });
    });
  }
  return out;
}

function splicePhaseBlock(
  items: PlanLayoutItem[],
  phaseSort: number,
  index: number,
  block: PlanLayoutItem[],
): PlanLayoutItem[] {
  const ordered = orderedItems(items);
  const phase = ordered.filter((item) => item.phaseSort === phaseSort);
  const others = ordered.filter((item) => item.phaseSort !== phaseSort);
  const nextPhase = [
    ...phase.slice(0, index),
    ...block.map((item) => ({ ...item, phaseSort })),
    ...phase.slice(index),
  ];
  return renumberLayout([...others, ...nextPhase]);
}

/**
 * Insert `block` into one phase. With no `after`, use the last legal index.
 * Members of `block` already in `items` are lifted out and placed with the block.
 * Returns null when no index is legal.
 */
export function insertPlanBlock(
  items: PlanLayoutItem[],
  dependencies: PlanDependencyEdge[],
  phaseSort: number,
  block: PlanLayoutItem[],
  after: PlanItemRef | null,
): PlanLayoutItem[] | null {
  const blockKeys = new Set(block.map(itemKey));
  const remaining = items.filter((item) => !blockKeys.has(itemKey(item)));
  const phase = orderedItems(remaining).filter((item) => item.phaseSort === phaseSort);
  if (after) {
    const index = phase.findIndex((item) => sameRef(item, after));
    if (index < 0) return null;
    const next = splicePhaseBlock(remaining, phaseSort, index + 1, block);
    return validatePlanOrder(next, dependencies).length === 0 ? next : null;
  }
  for (let index = phase.length; index >= 0; index -= 1) {
    const next = splicePhaseBlock(remaining, phaseSort, index, block);
    if (validatePlanOrder(next, dependencies).length === 0) return next;
  }
  return null;
}

/** Violations for one attempted insert: after `after`, or at the end of the phase when `after` is null. */
export function rejectedInsertViolations(
  items: PlanLayoutItem[],
  dependencies: PlanDependencyEdge[],
  phaseSort: number,
  block: PlanLayoutItem[],
  after: PlanItemRef | null,
): PlanOrderViolation[] {
  const blockKeys = new Set(block.map(itemKey));
  const remaining = items.filter((item) => !blockKeys.has(itemKey(item)));
  const phase = orderedItems(remaining).filter((item) => item.phaseSort === phaseSort);
  let index = phase.length;
  if (after) {
    const found = phase.findIndex((item) => sameRef(item, after));
    if (found < 0) {
      return [{ kind: "dependency", message: "No legal slot in that phase" }];
    }
    index = found + 1;
  }
  return validatePlanOrder(splicePhaseBlock(remaining, phaseSort, index, block), dependencies);
}

/**
 * Move the dependent and its in-plan descendants to just after the prerequisite's
 * block, staying in that phase. Returns null when the phase cannot be made legal.
 */
export function layoutBelowPrerequisite(
  items: PlanLayoutItem[],
  dependencies: PlanDependencyEdge[],
  edge: PlanDependencyEdge,
): PlanLayoutItem[] | null {
  const ordered = orderedItems(items);
  const prerequisite = ordered.find((item) => sameRef(item, edge.prerequisite));
  const dependent = ordered.find((item) => sameRef(item, edge.dependent));
  if (!prerequisite || !dependent) return null;
  if (prerequisite.phaseSort !== dependent.phaseSort) return null;
  const children = childKeys(ordered);
  const blockKeys = new Set([
    itemKey(dependent),
    ...descendantKeys(itemKey(dependent), children),
  ]);
  if (blockKeys.has(itemKey(prerequisite))) return null;
  const prerequisiteBlock = new Set([
    itemKey(prerequisite),
    ...descendantKeys(itemKey(prerequisite), children),
  ]);
  const phase = ordered.filter((item) => item.phaseSort === prerequisite.phaseSort);
  let insertAt = 0;
  phase.forEach((item, index) => {
    if (prerequisiteBlock.has(itemKey(item))) insertAt = index + 1;
  });
  const block = phase.filter((item) => blockKeys.has(itemKey(item)));
  const remainingPhase = phase.filter((item) => !blockKeys.has(itemKey(item)));
  const removedBefore = phase
    .slice(0, insertAt)
    .filter((item) => blockKeys.has(itemKey(item))).length;
  const adjusted = insertAt - removedBefore;
  const nextPhase = [
    ...remainingPhase.slice(0, adjusted),
    ...block,
    ...remainingPhase.slice(adjusted),
  ];
  const others = ordered.filter((item) => item.phaseSort !== prerequisite.phaseSort);
  const next = renumberLayout([...others, ...nextPhase]);
  const withEdge = [...dependencies, edge];
  return validatePlanOrder(next, withEdge).length === 0 ? next : null;
}

/** Set when exactly one shared plan becomes legal by moving the dependent below the prerequisite. */
export function addAndMoveOffer(
  plans: PlanSnapshot[],
  edge: PlanDependencyEdge,
): { planId: number } | null {
  const conflicts = conflictsForNewDependency(plans, edge);
  if (conflicts.length !== 1) return null;
  const plan = plans.find((candidate) => candidate.id === conflicts[0]?.id);
  if (!plan) return null;
  const moved = layoutBelowPrerequisite(plan.items, plan.dependencies, edge);
  return moved ? { planId: plan.id } : null;
}

export type PlanBlockerRef = {
  id: number;
  number: number;
  title: string;
  state: string;
};

export type PlanItemActionFlags = {
  canCheck: boolean;
  canStart: boolean;
  canStartAndComplete: boolean;
  canUncheck: boolean;
  blockedBy: PlanBlockerRef[];
};

/** Board checkbox menu. Viewers pass `canWrite: false` and get every flag false. */
export function planItemActions(input: {
  entityType: PlanEntityType;
  state: string;
  canWrite: boolean;
  canReopen: boolean;
  stateDerived: boolean;
  openBlockers: PlanBlockerRef[];
}): PlanItemActionFlags {
  const blockedBy = input.entityType === "task" ? input.openBlockers : [];
  const hidden: PlanItemActionFlags = {
    canCheck: false,
    canStart: false,
    canStartAndComplete: false,
    canUncheck: false,
    blockedBy,
  };
  if (!input.canWrite || input.stateDerived || input.state === "deleted") return hidden;
  if (input.entityType === "todo") {
    const closed =
      input.state === "complete" || input.state === "canceled" || input.state === "pending";
    return {
      ...hidden,
      canCheck: !closed,
      canUncheck: input.state === "complete",
    };
  }
  const open = input.openBlockers.length > 0;
  return {
    canCheck: (input.state === "in_progress" || input.state === "on_hold") && !open,
    canStart: input.state === "ready",
    canStartAndComplete: input.state === "ready" && !open,
    canUncheck: input.canReopen && (input.state === "complete" || input.state === "canceled"),
    blockedBy,
  };
}

export function conflictsForParentChange(
  plans: PlanSnapshot[],
  child: PlanItemRef,
  nextParent: PlanItemRef | null,
): PlanOrderConflict[] {
  if (nextParent == null) return [];
  const conflicts: PlanOrderConflict[] = [];
  for (const plan of plans) {
    if (!containsItem(plan.items, child) || !containsItem(plan.items, nextParent)) continue;
    const proposed = layoutAfterParentChange(plan.items, child, nextParent);
    if (proposed == null) {
      const byKey = new Map(plan.items.map((item) => [itemKey(item), item]));
      conflicts.push({
        id: plan.id,
        number: plan.number,
        title: plan.title,
        violations: [cycleViolation([itemKey(child), itemKey(nextParent)], byKey)],
      });
      continue;
    }
    const before = new Set(validatePlanOrder(plan.items, plan.dependencies).map(violationKey));
    const introduced = validatePlanOrder(proposed, plan.dependencies).filter(
      (violation) => !before.has(violationKey(violation)),
    );
    if (introduced.length === 0) continue;
    conflicts.push({
      id: plan.id,
      number: plan.number,
      title: plan.title,
      violations: introduced,
    });
  }
  return conflicts;
}

function conflictError(
  conflicts: PlanOrderConflict[],
  action: string,
  addAndMove?: { planId: number } | null,
): PlanRuleError {
  const names = conflicts.map((plan) => formatEntityRef("plan", plan.number)).join(", ");
  return new PlanRuleError(409, "plan_order_conflict", `${action} conflicts with ${names}`, {
    plans: conflicts.map((plan) => ({ id: plan.id, number: plan.number, title: plan.title })),
    ...(addAndMove ? { addAndMove } : {}),
  });
}

export function orderViolationError(violations: PlanOrderViolation[]): PlanRuleError {
  return new PlanRuleError(
    409,
    "plan_order_violation",
    violations.map((violation) => violation.message).join("; "),
    { violations },
  );
}

function asEntityType(value: string): PlanEntityType | null {
  if (value === "task" || value === "todo") return value;
  return null;
}

function hoursOf(value: unknown): number | null {
  if (value == null) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

async function loadPlansHoldingBoth(db: Db, a: PlanItemRef, b: PlanItemRef): Promise<PlanSnapshot[]> {
  if (sameRef(a, b)) return [];
  const membership = await db
    .select({
      planId: schema.planItems.planId,
      entityType: schema.planItems.entityType,
      entityId: schema.planItems.entityId,
    })
    .from(schema.planItems)
    .where(
      or(
        and(eq(schema.planItems.entityType, a.entityType), eq(schema.planItems.entityId, a.entityId)),
        and(eq(schema.planItems.entityType, b.entityType), eq(schema.planItems.entityId, b.entityId)),
      ),
    );
  const byPlan = new Map<number, Set<string>>();
  for (const row of membership) {
    const keys = byPlan.get(row.planId) ?? new Set<string>();
    keys.add(`${row.entityType}:${row.entityId}`);
    byPlan.set(row.planId, keys);
  }
  const planIds = [...byPlan.entries()]
    .filter(([, keys]) => keys.has(itemKey(a)) && keys.has(itemKey(b)))
    .map(([planId]) => planId);
  if (planIds.length === 0) return [];

  const [planRows, phaseRows, itemRows] = await Promise.all([
    db
      .select({ id: schema.plans.id, number: schema.plans.number, title: schema.plans.title })
      .from(schema.plans)
      .where(inArray(schema.plans.id, planIds)),
    db
      .select({
        id: schema.planPhases.id,
        planId: schema.planPhases.planId,
        sortOrder: schema.planPhases.sortOrder,
      })
      .from(schema.planPhases)
      .where(inArray(schema.planPhases.planId, planIds)),
    db
      .select({
        planId: schema.planItems.planId,
        phaseId: schema.planItems.phaseId,
        entityType: schema.planItems.entityType,
        entityId: schema.planItems.entityId,
        sortOrder: schema.planItems.sortOrder,
      })
      .from(schema.planItems)
      .where(inArray(schema.planItems.planId, planIds)),
  ]);

  const taskIds = [
    ...new Set(
      itemRows.filter((row) => row.entityType === "task").map((row) => row.entityId),
    ),
  ];
  const todoIds = [
    ...new Set(
      itemRows.filter((row) => row.entityType === "todo").map((row) => row.entityId),
    ),
  ];
  const [taskRows, todoRows, depRows] = await Promise.all([
    taskIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: schema.tasks.id,
            number: schema.tasks.number,
            parentId: schema.tasks.parentId,
            state: schema.tasks.state,
            estimateHours: schema.tasks.estimateHours,
          })
          .from(schema.tasks)
          .where(inArray(schema.tasks.id, taskIds)),
    todoIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: schema.todos.id,
            number: schema.todos.number,
            parentId: schema.todos.parentId,
            state: schema.todos.state,
            estimateHours: schema.todos.estimateHours,
            progress: schema.todos.progress,
          })
          .from(schema.todos)
          .where(inArray(schema.todos.id, todoIds)),
    taskIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            taskId: schema.taskDependencies.taskId,
            dependsOnTaskId: schema.taskDependencies.dependsOnTaskId,
          })
          .from(schema.taskDependencies)
          .where(
            and(
              inArray(schema.taskDependencies.taskId, taskIds),
              inArray(schema.taskDependencies.dependsOnTaskId, taskIds),
            ),
          ),
  ]);

  const tasksById = new Map(taskRows.map((row) => [row.id, row]));
  const todosById = new Map(todoRows.map((row) => [row.id, row]));
  const phaseSort = new Map(phaseRows.map((row) => [row.id, row.sortOrder]));

  return planRows.map((plan) => {
    const rows = itemRows.filter((row) => row.planId === plan.id);
    const taskIdsInPlan = new Set(
      rows.filter((row) => row.entityType === "task").map((row) => row.entityId),
    );
    const todoIdsInPlan = new Set(
      rows.filter((row) => row.entityType === "todo").map((row) => row.entityId),
    );
    const items: PlanLayoutItem[] = [];
    for (const row of rows) {
      const entityType = asEntityType(row.entityType);
      if (!entityType) continue;
      if (entityType === "task") {
        const task = tasksById.get(row.entityId);
        if (!task) continue;
        const parent =
          task.parentId != null && taskIdsInPlan.has(task.parentId)
            ? { entityType: "task" as const, entityId: task.parentId }
            : null;
        items.push({
          entityType,
          entityId: task.id,
          number: task.number,
          phaseSort: phaseSort.get(row.phaseId) ?? 0,
          itemSort: row.sortOrder,
          parent,
          state: task.state,
          estimateHours: hoursOf(task.estimateHours),
          progress: 0,
        });
      } else {
        const todo = todosById.get(row.entityId);
        if (!todo) continue;
        const parent =
          todo.parentId != null && todoIdsInPlan.has(todo.parentId)
            ? { entityType: "todo" as const, entityId: todo.parentId }
            : null;
        items.push({
          entityType,
          entityId: todo.id,
          number: todo.number,
          phaseSort: phaseSort.get(row.phaseId) ?? 0,
          itemSort: row.sortOrder,
          parent,
          state: todo.state,
          estimateHours: hoursOf(todo.estimateHours),
          progress: todo.progress,
        });
      }
    }
    const dependencies: PlanDependencyEdge[] = depRows
      .filter((row) => taskIdsInPlan.has(row.taskId) && taskIdsInPlan.has(row.dependsOnTaskId))
      .map((row) => ({
        prerequisite: { entityType: "task", entityId: row.dependsOnTaskId },
        dependent: { entityType: "task", entityId: row.taskId },
      }));
    return { id: plan.id, number: plan.number, title: plan.title, items, dependencies };
  });
}

/**
 * When `planId` is the single plan that can be fixed in-phase, move the dependent
 * below the prerequisite and bump that plan's revision. Throws `plan_order_conflict`
 * when the id is not the offered plan. No-op when the new edge is already legal.
 */
export async function relocateForNewDependency(
  db: Db,
  planId: number,
  dependentTaskId: number,
  prerequisiteTaskId: number,
): Promise<void> {
  const edge: PlanDependencyEdge = {
    prerequisite: { entityType: "task", entityId: prerequisiteTaskId },
    dependent: { entityType: "task", entityId: dependentTaskId },
  };
  const [locked] = await db
    .select({ id: schema.plans.id, revision: schema.plans.revision })
    .from(schema.plans)
    .where(eq(schema.plans.id, planId))
    .for("update");
  if (!locked) {
    throw new PlanRuleError(404, "not_found", "Plan not found");
  }
  const plans = await loadPlansHoldingBoth(db, edge.dependent, edge.prerequisite);
  const conflicts = conflictsForNewDependency(plans, edge);
  if (conflicts.length === 0) return;
  const offer = addAndMoveOffer(plans, edge);
  if (offer?.planId !== planId) {
    throw conflictError(conflicts, "Adding that dependency", offer);
  }
  const plan = plans.find((candidate) => candidate.id === planId);
  const next = plan ? layoutBelowPrerequisite(plan.items, plan.dependencies, edge) : null;
  if (!plan || !next) {
    throw conflictError(conflicts, "Adding that dependency", offer);
  }
  for (const item of next) {
    await db
      .update(schema.planItems)
      .set({ sortOrder: item.itemSort })
      .where(
        and(
          eq(schema.planItems.planId, planId),
          eq(schema.planItems.entityType, item.entityType),
          eq(schema.planItems.entityId, item.entityId),
        ),
      );
  }
  await db
    .update(schema.plans)
    .set({ revision: locked.revision + 1, updatedAt: new Date() })
    .where(eq(schema.plans.id, planId));
}

export async function assertDependencyRespectsPlans(
  db: Db,
  dependentTaskId: number,
  prerequisiteTaskId: number,
): Promise<void> {
  const edge: PlanDependencyEdge = {
    prerequisite: { entityType: "task", entityId: prerequisiteTaskId },
    dependent: { entityType: "task", entityId: dependentTaskId },
  };
  const plans = await loadPlansHoldingBoth(db, edge.dependent, edge.prerequisite);
  const conflicts = conflictsForNewDependency(plans, edge);
  if (conflicts.length > 0) {
    throw conflictError(conflicts, "Adding that dependency", addAndMoveOffer(plans, edge));
  }
}

export { projectPlanFinish } from "./planProjection.js";
export type {
  PlanProjection,
  PlanProjectionDriver,
  PlanProjectionInput,
  PlanProjectionInputs,
  PlanProjectionItem,
} from "./planProjection.js";

export async function assertParentChangeRespectsPlans(
  db: Db,
  entityType: PlanEntityType,
  entityId: number,
  nextParentId: number | null,
): Promise<void> {
  if (nextParentId == null) return;
  const child: PlanItemRef = { entityType, entityId };
  const nextParent: PlanItemRef = { entityType, entityId: nextParentId };
  const plans = await loadPlansHoldingBoth(db, child, nextParent);
  const conflicts = conflictsForParentChange(plans, child, nextParent);
  if (conflicts.length > 0) {
    throw conflictError(conflicts, "Changing that parent");
  }
}
