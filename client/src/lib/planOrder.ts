import { formatEntityRef } from "./entityRef";

export type PlanOrderRef = {
  entityType: "task" | "todo";
  entityId: number;
};

export type PlanOrderRow = PlanOrderRef & {
  id: number;
  number: number;
  title: string;
  parentId: number | null;
};

export type PlanOrderPhase = {
  id: number;
  name: string;
  sortOrder: number;
  items: PlanOrderRow[];
};

export type PlanOrderEdge = {
  prerequisite: PlanOrderRef;
  dependent: PlanOrderRef;
};

/** Index in the phase after the moving block has been taken out. */
export type PlanGap = {
  phaseId: number;
  index: number;
};

export type PlanGapVerdict = {
  legal: boolean;
  reason: string | null;
  noop: boolean;
};

export type PlanAutoSortPreview = {
  phases: Array<{ phaseSort: number; items: PlanOrderRef[]; changed: boolean }>;
  conflicts: Array<{ message: string }>;
};

export type PlanFixSummary = {
  alreadyLegal: boolean;
  canApply: boolean;
  conflicts: string[];
  moves: Array<{ phaseName: string; rows: Array<{ key: string; label: string; moved: boolean }> }>;
};

type PlacedRow = PlanOrderRow & { phaseId: number; phaseSort: number };

function rowKey(ref: PlanOrderRef): string {
  return `${ref.entityType}:${ref.entityId}`;
}

function labelOf(row: PlanOrderRef & { number?: number }): string {
  return row.number != null ? formatEntityRef(row.entityType, row.number) : rowKey(row);
}

function flatten(phases: readonly PlanOrderPhase[]): PlacedRow[] {
  return phases.flatMap((phase, phaseSort) =>
    phase.items.map((item) => ({ ...item, phaseId: phase.id, phaseSort })),
  );
}

function childrenOf(rows: readonly PlacedRow[]): Map<string, PlacedRow[]> {
  const present = new Set(rows.map(rowKey));
  const map = new Map<string, PlacedRow[]>();
  for (const row of rows) {
    if (row.parentId == null) continue;
    const parentKey = `${row.entityType}:${row.parentId}`;
    if (!present.has(parentKey)) continue;
    const list = map.get(parentKey) ?? [];
    list.push(row);
    map.set(parentKey, list);
  }
  return map;
}

function descendants(parentKey: string, children: Map<string, PlacedRow[]>): PlacedRow[] {
  const out: PlacedRow[] = [];
  const seen = new Set<string>();
  const stack = [...(children.get(parentKey) ?? [])];
  while (stack.length > 0) {
    const row = stack.pop();
    if (!row) continue;
    const key = rowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    stack.push(...(children.get(key) ?? []));
  }
  return out;
}

function kahn(nodes: string[], edges: Array<[string, string]>): string[] {
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
    ready.sort((a, b) => a.localeCompare(b));
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
  return nodes.filter((node) => !emitted.has(node));
}

/** First dependency, enclosure, or cycle problem. Null when the layout is legal. */
export function planOrderViolation(
  phases: readonly PlanOrderPhase[],
  edges: readonly PlanOrderEdge[],
): string | null {
  const ordered = flatten(phases);
  const byKey = new Map(ordered.map((row) => [rowKey(row), row]));
  const index = new Map(ordered.map((row, position) => [rowKey(row), position]));

  for (const edge of edges) {
    const from = index.get(rowKey(edge.prerequisite));
    const to = index.get(rowKey(edge.dependent));
    if (from == null || to == null) continue;
    if (from >= to) {
      const dependent = byKey.get(rowKey(edge.dependent));
      const prerequisite = byKey.get(rowKey(edge.prerequisite));
      if (dependent && prerequisite) {
        return `${labelOf(dependent)} depends on ${labelOf(prerequisite)}`;
      }
    }
  }

  const children = childrenOf(ordered);
  for (const [parentKey, kids] of children) {
    const parent = byKey.get(parentKey);
    if (!parent) continue;
    const below = descendants(parentKey, children);
    const otherPhase = below.filter((row) => row.phaseId !== parent.phaseId);
    if (otherPhase.length > 0) {
      const child = otherPhase[0];
      if (child) return `${labelOf(child)} must stay in ${labelOf(parent)}'s block`;
      continue;
    }
    const members = [parent, ...below];
    const indexes = members.map((row) => index.get(rowKey(row)) ?? 0);
    const min = Math.min(...indexes);
    const max = Math.max(...indexes);
    const parentIndex = index.get(parentKey) ?? 0;
    if (parentIndex !== min || max - min + 1 !== members.length) {
      const child = kids[0];
      if (child) return `${labelOf(child)} must stay in ${labelOf(parent)}'s block`;
    }
  }

  const precedence: Array<[string, string]> = [];
  for (const edge of edges) {
    const from = rowKey(edge.prerequisite);
    const to = rowKey(edge.dependent);
    if (byKey.has(from) && byKey.has(to)) precedence.push([from, to]);
  }
  for (const [parentKey, kids] of children) {
    const parent = byKey.get(parentKey);
    if (!parent) continue;
    for (const kid of kids) {
      if (kid.phaseId === parent.phaseId) precedence.push([parentKey, rowKey(kid)]);
    }
  }
  const leftover = kahn(
    ordered.map(rowKey),
    precedence,
  );
  if (leftover.length > 0) {
    const labels = [...leftover].sort((a, b) => a.localeCompare(b)).map((key) => {
      const row = byKey.get(key);
      return row ? labelOf(row) : key;
    });
    return `Cycle among ${labels.join(", ")}`;
  }
  return null;
}

/** The row plus every in-plan descendant, in current visual order. */
export function planMovingIds(phases: readonly PlanOrderPhase[], itemId: number): number[] {
  const rows = flatten(phases);
  const start = rows.find((row) => row.id === itemId);
  if (!start) return [];
  const children = childrenOf(rows);
  const block = new Set<number>([start.id]);
  const stack = [...(children.get(rowKey(start)) ?? [])];
  while (stack.length > 0) {
    const row = stack.pop();
    if (!row || block.has(row.id)) continue;
    block.add(row.id);
    stack.push(...(children.get(rowKey(row)) ?? []));
  }
  return rows.filter((row) => block.has(row.id)).map((row) => row.id);
}

export function planApplyGap(
  phases: readonly PlanOrderPhase[],
  movingIds: readonly number[],
  gap: PlanGap,
): PlanOrderPhase[] {
  const moving = new Set(movingIds);
  const block = flatten(phases).filter((row) => moving.has(row.id));
  return phases.map((phase) => {
    const kept = phase.items.filter((item) => !moving.has(item.id));
    if (phase.id !== gap.phaseId) return { ...phase, items: kept };
    const index = Math.max(0, Math.min(gap.index, kept.length));
    return {
      ...phase,
      items: [...kept.slice(0, index), ...block, ...kept.slice(index)],
    };
  });
}

function sameLayout(left: readonly PlanOrderPhase[], right: readonly PlanOrderPhase[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((phase, index) => {
    const other = right[index];
    if (!other || other.id !== phase.id || other.items.length !== phase.items.length) return false;
    return phase.items.every((item, itemIndex) => item.id === other.items[itemIndex]?.id);
  });
}

export function planJudgeGap(
  phases: readonly PlanOrderPhase[],
  movingIds: readonly number[],
  gap: PlanGap,
  edges: readonly PlanOrderEdge[],
): PlanGapVerdict {
  if (movingIds.length === 0) {
    return { legal: false, reason: "Item is not on this plan", noop: false };
  }
  if (!phases.some((phase) => phase.id === gap.phaseId)) {
    return { legal: false, reason: "Phase is not on this plan", noop: false };
  }
  const next = planApplyGap(phases, movingIds, gap);
  if (sameLayout(phases, next)) return { legal: true, reason: null, noop: true };
  const reason = planOrderViolation(next, edges);
  if (reason) return { legal: false, reason, noop: false };
  return { legal: true, reason: null, noop: false };
}

export function planGapBeforeItem(
  phases: readonly PlanOrderPhase[],
  movingIds: readonly number[],
  itemId: number,
): PlanGap | null {
  const moving = new Set(movingIds);
  if (moving.has(itemId)) return null;
  for (const phase of phases) {
    const kept = phase.items.filter((item) => !moving.has(item.id));
    const index = kept.findIndex((item) => item.id === itemId);
    if (index >= 0) return { phaseId: phase.id, index };
  }
  return null;
}

export function planGapAtPhaseEnd(
  phases: readonly PlanOrderPhase[],
  movingIds: readonly number[],
  phaseId: number,
): PlanGap {
  const moving = new Set(movingIds);
  const phase = phases.find((candidate) => candidate.id === phaseId);
  const kept = phase ? phase.items.filter((item) => !moving.has(item.id)).length : 0;
  return { phaseId, index: kept };
}

export function planSlotVerdicts(
  phases: readonly PlanOrderPhase[],
  movingIds: readonly number[],
  edges: readonly PlanOrderEdge[],
): { before: Map<number, PlanGapVerdict>; phaseEnd: Map<number, PlanGapVerdict> } {
  const moving = new Set(movingIds);
  const before = new Map<number, PlanGapVerdict>();
  const phaseEnd = new Map<number, PlanGapVerdict>();
  for (const phase of phases) {
    for (const item of phase.items) {
      if (moving.has(item.id)) continue;
      const gap = planGapBeforeItem(phases, movingIds, item.id);
      if (gap) before.set(item.id, planJudgeGap(phases, movingIds, gap, edges));
    }
    phaseEnd.set(phase.id, planJudgeGap(phases, movingIds, planGapAtPhaseEnd(phases, movingIds, phase.id), edges));
  }
  return { before, phaseEnd };
}

function currentGap(phases: readonly PlanOrderPhase[], movingIds: readonly number[]): PlanGap | null {
  const moving = new Set(movingIds);
  for (const phase of phases) {
    const index = phase.items.findIndex((item) => moving.has(item.id));
    if (index < 0) continue;
    const removedBefore = phase.items.slice(0, index).filter((item) => moving.has(item.id)).length;
    return { phaseId: phase.id, index: index - removedBefore };
  }
  return null;
}

function stepGap(
  phases: readonly PlanOrderPhase[],
  movingIds: readonly number[],
  gap: PlanGap,
  direction: "up" | "down",
): PlanGap | null {
  const moving = new Set(movingIds);
  const phaseIndex = phases.findIndex((phase) => phase.id === gap.phaseId);
  const phase = phases[phaseIndex];
  if (!phase) return null;
  const kept = phase.items.filter((item) => !moving.has(item.id));
  if (direction === "up") {
    if (gap.index > 0) return { phaseId: phase.id, index: gap.index - 1 };
    const previous = phases[phaseIndex - 1];
    if (!previous) return null;
    return {
      phaseId: previous.id,
      index: previous.items.filter((item) => !moving.has(item.id)).length,
    };
  }
  if (gap.index < kept.length) return { phaseId: phase.id, index: gap.index + 1 };
  const next = phases[phaseIndex + 1];
  if (!next) return null;
  return { phaseId: next.id, index: 0 };
}

export function planAdjacentGap(
  phases: readonly PlanOrderPhase[],
  itemId: number,
  direction: "up" | "down",
  edges: readonly PlanOrderEdge[],
): { gap: PlanGap | null; verdict: PlanGapVerdict } {
  const movingIds = planMovingIds(phases, itemId);
  if (movingIds.length === 0) {
    return { gap: null, verdict: { legal: false, reason: "Item is not on this plan", noop: false } };
  }
  const current = currentGap(phases, movingIds);
  if (!current) {
    return { gap: null, verdict: { legal: false, reason: "Item is not on this plan", noop: false } };
  }
  const gap = stepGap(phases, movingIds, current, direction);
  if (!gap) {
    const reason = direction === "up" ? "Already first on the plan" : "Already last on the plan";
    return { gap: null, verdict: { legal: false, reason, noop: false } };
  }
  return { gap, verdict: planJudgeGap(phases, movingIds, gap, edges) };
}

export function planReorderBody(revision: number, phases: readonly PlanOrderPhase[]) {
  return {
    revision,
    phases: phases.map((phase) => ({
      phaseId: phase.id,
      itemIds: phase.items.map((item) => item.id),
    })),
  };
}

export function planFixSummary(
  phases: readonly PlanOrderPhase[],
  preview: PlanAutoSortPreview,
): PlanFixSummary {
  const conflicts = preview.conflicts.map((conflict) => conflict.message);
  const rowsByKey = new Map(flatten(phases).map((row) => [rowKey(row), row]));
  const moves: PlanFixSummary["moves"] = [];
  for (const phasePreview of preview.phases) {
    if (!phasePreview.changed) continue;
    const phase = phases.find((candidate) => candidate.sortOrder === phasePreview.phaseSort);
    const currentIndex = new Map((phase?.items ?? []).map((item, index) => [rowKey(item), index]));
    moves.push({
      phaseName: phase?.name ?? "Phase",
      rows: phasePreview.items.map((ref, index) => {
        const row = rowsByKey.get(rowKey(ref));
        const label = row ? `${labelOf(row)} ${row.title}` : rowKey(ref);
        return {
          key: `${rowKey(ref)}:${index}`,
          label,
          moved: currentIndex.get(rowKey(ref)) !== index,
        };
      }),
    });
  }
  const canApply = moves.length > 0;
  return {
    alreadyLegal: !canApply && conflicts.length === 0,
    canApply,
    conflicts,
    moves,
  };
}
