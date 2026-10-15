import type { PlanDependencyEdge, PlanEntityType, PlanItemRef } from "./plans.js";

const WINDOW_MS = 28 * 24 * 60 * 60 * 1000;
const EXCLUDED = new Set(["canceled", "deleted"]);

export type PlanProjectionItem = PlanItemRef & {
  parent: PlanItemRef | null;
  state: string;
  estimateHours: number | null;
  /** ToDo progress 0–100. Tasks ignore it. */
  progress?: number;
  /**
   * When the item is `complete`, the time of its latest state change to Complete.
   * Null when that activity row is missing.
   */
  completedAt: string | null;
};

export type PlanProjectionDriver =
  | "velocity"
  | "capacity"
  | "critical_path"
  | "needs_capacity"
  | "needs_estimates"
  | "complete";

export type PlanProjectionInputs = {
  completedHours28d: number;
  velocityHoursPerWeek: number | null;
  capacityHoursPerWeek: number | null;
  hoursPerWeek: number | null;
  rateSource: "velocity" | "capacity" | null;
  remainingHours: number;
  criticalPathHours: number | null;
  throughputFinish: string | null;
  criticalPathFinish: string | null;
  workdayHours: number;
  unestimatedCount: number;
  itemCount: number;
  uncertainty: number;
};

export type PlanProjection = {
  earliest: string | null;
  latest: string | null;
  center: string | null;
  driver: PlanProjectionDriver;
  inputs: PlanProjectionInputs;
};

export type PlanProjectionInput = {
  now: Date;
  workdayHours: number;
  capacityHoursPerWeek: number | null;
  items: PlanProjectionItem[];
  dependencies: PlanDependencyEdge[];
};

function itemKey(ref: PlanItemRef): string {
  return `${ref.entityType}:${ref.entityId}`;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function counted(item: PlanProjectionItem): boolean {
  return !EXCLUDED.has(item.state);
}

function doneFraction(item: PlanProjectionItem): number {
  if (item.state === "complete" || item.state === "pending") return 1;
  if (item.entityType === "todo") {
    const progress = item.progress ?? 0;
    return Math.min(100, Math.max(0, progress)) / 100;
  }
  return 0;
}

/** Same leaf rule as `computePlanRollup`: a parent with a counted in-plan child contributes no hours. */
function leavesOf(items: PlanProjectionItem[]): PlanProjectionItem[] {
  const children = new Map<string, string[]>();
  const byKey = new Map<string, PlanProjectionItem>();
  for (const item of items) {
    const key = itemKey(item);
    byKey.set(key, item);
    if (!children.has(key)) children.set(key, []);
  }
  for (const item of items) {
    if (!item.parent) continue;
    const parentKey = itemKey(item.parent);
    const kids = children.get(parentKey);
    if (kids) kids.push(itemKey(item));
  }
  return items.filter((item) => {
    if (!counted(item)) return false;
    const kids = children.get(itemKey(item)) ?? [];
    return !kids.some((key) => {
      const child = byKey.get(key);
      return child != null && counted(child);
    });
  });
}

function remainingOf(item: PlanProjectionItem): number {
  if (item.estimateHours == null) return 0;
  return item.estimateHours * (1 - doneFraction(item));
}

function utcDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

function parseUtcDate(iso: string): Date {
  const parts = iso.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addCalendarDays(iso: string, days: number): string {
  const date = parseUtcDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDate(date);
}

function isWeekday(iso: string): boolean {
  const day = parseUtcDate(iso).getUTCDay();
  return day !== 0 && day !== 6;
}

function daysBetween(from: string, to: string): number {
  return Math.round((parseUtcDate(to).getTime() - parseUtcDate(from).getTime()) / 86_400_000);
}

/** `workingDays` counts today when today is a weekday. Zero lands on today. */
function addWorkingDays(start: string, workingDays: number): string {
  if (workingDays <= 0) return start;
  let cursor = start;
  while (!isWeekday(cursor)) cursor = addCalendarDays(cursor, 1);
  let left = workingDays - 1;
  while (left > 0) {
    cursor = addCalendarDays(cursor, 1);
    if (isWeekday(cursor)) left -= 1;
  }
  return cursor;
}

function longestChainHours(
  nodes: Array<{ key: string; hours: number }>,
  edges: Array<[string, string]>,
): number | null {
  const weight = new Map(nodes.map((node) => [node.key, node.hours]));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of nodes) {
    outgoing.set(node.key, []);
    indegree.set(node.key, 0);
  }
  const seen = new Set<string>();
  for (const [from, to] of edges) {
    if (!weight.has(from) || !weight.has(to) || from === to) continue;
    const edgeKey = `${from}>${to}`;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);
    outgoing.get(from)?.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }
  const queue = [...indegree.keys()].filter((key) => (indegree.get(key) ?? 0) === 0);
  const topo: string[] = [];
  while (queue.length > 0) {
    const key = queue.shift();
    if (key == null) break;
    topo.push(key);
    for (const next of outgoing.get(key) ?? []) {
      const degree = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  if (topo.length !== nodes.length) return null;
  const dist = new Map<string, number>();
  for (const node of nodes) dist.set(node.key, node.hours);
  for (const key of topo) {
    const base = dist.get(key) ?? 0;
    for (const next of outgoing.get(key) ?? []) {
      const candidate = base + (weight.get(next) ?? 0);
      if (candidate > (dist.get(next) ?? 0)) dist.set(next, candidate);
    }
  }
  let max = 0;
  for (const value of dist.values()) max = Math.max(max, value);
  return max;
}

function result(
  driver: PlanProjectionDriver,
  dates: { earliest: string | null; latest: string | null; center: string | null },
  inputs: PlanProjectionInputs,
): PlanProjection {
  return { ...dates, driver, inputs };
}

/**
 * Deterministic finish range. Throughput uses a weekly rate on calendar days.
 * The critical path uses working days (Mon–Fri). The later date is the center.
 */
export function projectPlanFinish(input: PlanProjectionInput): PlanProjection {
  const today = utcDate(input.now);
  const leaves = leavesOf(input.items);
  const leafKeys = new Set(leaves.map(itemKey));
  const open = leaves.filter((item) => doneFraction(item) < 1);
  const remainingHours = round4(leaves.reduce((sum, item) => sum + remainingOf(item), 0));
  const unestimatedCount = leaves.filter((item) => item.estimateHours == null).length;
  const itemCount = leaves.length;
  const uncertainty = itemCount === 0 ? 0.25 : Math.min(1, round4(0.25 + unestimatedCount / itemCount));
  const windowStart = input.now.getTime() - WINDOW_MS;
  let completedHours28d = 0;
  for (const item of leaves) {
    if (item.state !== "complete" || item.completedAt == null || item.estimateHours == null) continue;
    const at = Date.parse(item.completedAt);
    if (!Number.isFinite(at) || at < windowStart) continue;
    completedHours28d += item.estimateHours;
  }
  completedHours28d = round4(completedHours28d);
  const velocityHoursPerWeek = completedHours28d > 0 ? round4(completedHours28d / 4) : null;
  const capacity =
    input.capacityHoursPerWeek != null && input.capacityHoursPerWeek > 0
      ? input.capacityHoursPerWeek
      : null;
  let rateSource: "velocity" | "capacity" | null = null;
  if (velocityHoursPerWeek != null) rateSource = "velocity";
  else if (capacity != null) rateSource = "capacity";
  const hoursPerWeek = velocityHoursPerWeek ?? capacity;

  const countedItems = input.items.filter(counted);
  const weights = new Map(countedItems.map((item) => [itemKey(item), leafKeys.has(itemKey(item)) ? remainingOf(item) : 0]));
  const criticalPathHours = longestChainHours(
    countedItems.map((item) => ({ key: itemKey(item), hours: weights.get(itemKey(item)) ?? 0 })),
    input.dependencies.map((edge) => [itemKey(edge.prerequisite), itemKey(edge.dependent)]),
  );

  const blankDates = { earliest: null, latest: null, center: null };
  const inputsBase = {
    completedHours28d,
    velocityHoursPerWeek,
    capacityHoursPerWeek: capacity,
    hoursPerWeek,
    rateSource,
    remainingHours,
    criticalPathHours: criticalPathHours == null ? null : round4(criticalPathHours),
    throughputFinish: null as string | null,
    criticalPathFinish: null as string | null,
    workdayHours: input.workdayHours,
    unestimatedCount,
    itemCount,
    uncertainty,
  };

  if (open.length === 0) {
    return result("complete", { earliest: today, latest: today, center: today }, {
      ...inputsBase,
      throughputFinish: today,
      criticalPathFinish: today,
    });
  }

  const openEstimated = open.some((item) => item.estimateHours != null);
  if (!openEstimated) {
    return result("needs_estimates", blankDates, inputsBase);
  }

  if (remainingHours > 0 && hoursPerWeek == null) {
    return result("needs_capacity", blankDates, inputsBase);
  }

  const throughputDays =
    remainingHours <= 0 || hoursPerWeek == null ? 0 : Math.round((remainingHours / hoursPerWeek) * 7);
  const throughputFinish = addCalendarDays(today, throughputDays);
  const workingDays =
    criticalPathHours == null || input.workdayHours <= 0
      ? null
      : Math.round(criticalPathHours / input.workdayHours);
  const criticalPathFinish = workingDays == null ? null : addWorkingDays(today, workingDays);
  const criticalLater =
    criticalPathFinish != null && daysBetween(throughputFinish, criticalPathFinish) > 0;
  const center = criticalLater && criticalPathFinish != null ? criticalPathFinish : throughputFinish;
  const driver: PlanProjectionDriver = criticalLater
    ? "critical_path"
    : rateSource ?? "critical_path";
  const span = Math.max(0, daysBetween(today, center));
  const half = Math.round(span * uncertainty);
  const rawEarliest = addCalendarDays(center, -half);
  const earliest = daysBetween(today, rawEarliest) < 0 ? today : rawEarliest;
  return result(
    driver,
    { earliest, latest: addCalendarDays(center, half), center },
    { ...inputsBase, throughputFinish, criticalPathFinish },
  );
}

export function projectionEntityKey(entityType: PlanEntityType, entityId: number): string {
  return `${entityType}:${entityId}`;
}
