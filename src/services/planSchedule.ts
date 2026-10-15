import type { PlanDependencyEdge, PlanEntityType, PlanItemRef } from "./plans.js";
import { isDependencySatisfied } from "../lib/dependencySatisfied.js";

const EXCLUDED = new Set(["canceled", "deleted"]);
const EPOCH = "2020-01-06";
const EPS = 1e-6;

export type ScheduleMarker = "bar" | "bracket" | "unestimated";

export type ScheduleItemInput = {
  entityType: PlanEntityType;
  entityId: number;
  phaseSort: number;
  itemSort: number;
  parent: PlanItemRef | null;
  state: string;
  estimateHours: number | null;
  progress?: number;
  startDate: string | null;
  dueDate: string | null;
  /** Latest transition to In Progress, ISO-8601. */
  startedAt: string | null;
  /** Latest transition to Complete, ISO-8601. */
  completedAt: string | null;
};

export type SchedulePlanInput = {
  now: Date;
  workdayHours: number;
  planStart: string | null;
  items: ScheduleItemInput[];
  dependencies: PlanDependencyEdge[];
};

export type ScheduleRow = {
  key: string;
  entityType: PlanEntityType;
  entityId: number;
  phaseSort: number;
  itemSort: number;
  parentKey: string | null;
  state: string;
  estimateHours: number | null;
  remainingHours: number;
  dueDate: string | null;
  start: string;
  end: string;
  startFraction: number;
  endFraction: number;
  actual: boolean;
  marker: ScheduleMarker;
  critical: boolean;
  slackDays: number;
  prerequisiteKeys: string[];
  waitingOn: string[];
};

export type SchedulePlan = {
  anchor: string;
  workdayHours: number;
  criticalPathFinish: string | null;
  cycle: boolean;
  rows: ScheduleRow[];
};

type Placed = {
  scheduleStart: number;
  scheduleEnd: number;
  start: string;
  end: string;
  startFraction: number;
  endFraction: number;
  actual: boolean;
  marker: ScheduleMarker;
  remainingHours: number;
};

function itemKey(ref: PlanItemRef): string {
  return `${ref.entityType}:${ref.entityId}`;
}

function utcDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

function parseUtcDate(iso: string): Date {
  const parts = iso.split("-").map(Number);
  return new Date(Date.UTC(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1));
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

function onOrAfterWeekday(iso: string): string {
  let cursor = iso;
  while (!isWeekday(cursor)) cursor = addCalendarDays(cursor, 1);
  return cursor;
}

/** Same packing as the baseline: today counts when it is a weekday. Zero lands on today. */
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

/** Weekday mornings strictly before `date`, counted from a Monday epoch. */
function workingMorningsBefore(date: string): number {
  let count = 0;
  let cursor = EPOCH;
  if (date >= EPOCH) {
    while (cursor < date) {
      if (isWeekday(cursor)) count += 1;
      cursor = addCalendarDays(cursor, 1);
    }
    return count;
  }
  while (cursor > date) {
    cursor = addCalendarDays(cursor, -1);
    if (isWeekday(cursor)) count -= 1;
  }
  return count;
}

function dateAtIndex(index: number): { date: string; fraction: number } {
  let whole = Math.floor(index + EPS);
  let fraction = index - whole;
  if (fraction < EPS) fraction = 0;
  if (fraction > 1 - EPS) {
    whole += 1;
    fraction = 0;
  }
  let date = EPOCH;
  let left = whole;
  if (left >= 0) {
    while (left > 0) {
      date = addCalendarDays(date, 1);
      if (isWeekday(date)) left -= 1;
    }
  } else {
    while (left < 0) {
      date = addCalendarDays(date, -1);
      if (isWeekday(date)) left += 1;
    }
  }
  return { date, fraction };
}

function inclusiveEnd(index: number, zeroDuration: boolean): { date: string; fraction: number } {
  if (zeroDuration) return dateAtIndex(index);
  const end = dateAtIndex(index);
  if (end.fraction !== 0) return end;
  let date = addCalendarDays(end.date, -1);
  while (!isWeekday(date)) date = addCalendarDays(date, -1);
  return { date, fraction: 1 };
}

function counted(item: ScheduleItemInput): boolean {
  return !EXCLUDED.has(item.state);
}

function doneFraction(item: ScheduleItemInput): number {
  if (item.state === "complete" || item.state === "pending") return 1;
  if (item.entityType === "todo") {
    const progress = item.progress ?? 0;
    return Math.min(100, Math.max(0, progress)) / 100;
  }
  return 0;
}

function leavesOf(items: ScheduleItemInput[]): Set<string> {
  const children = new Map<string, string[]>();
  const byKey = new Map<string, ScheduleItemInput>();
  for (const item of items) {
    const key = itemKey(item);
    byKey.set(key, item);
    if (!children.has(key)) children.set(key, []);
  }
  for (const item of items) {
    if (!item.parent) continue;
    const kids = children.get(itemKey(item.parent));
    if (kids) kids.push(itemKey(item));
  }
  const leaves = new Set<string>();
  for (const item of items) {
    if (!counted(item)) continue;
    const kids = children.get(itemKey(item)) ?? [];
    const hasCountedChild = kids.some((key) => {
      const child = byKey.get(key);
      return child != null && counted(child);
    });
    if (!hasCountedChild) leaves.add(itemKey(item));
  }
  return leaves;
}

function remainingOf(item: ScheduleItemInput, leaves: Set<string>): number {
  if (!leaves.has(itemKey(item)) || item.estimateHours == null) return 0;
  return item.estimateHours * (1 - doneFraction(item));
}

function rawDuration(hours: number, workdayHours: number): number {
  if (hours <= 0 || workdayHours <= 0) return 0;
  return hours / workdayHours;
}

type Chain = { cycle: boolean; hours: number | null; path: string[] };

function longestChain(
  nodes: Array<{ key: string; hours: number }>,
  edges: Array<[string, string]>,
): Chain {
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
  if (topo.length !== nodes.length) return { cycle: true, hours: null, path: [] };
  const dist = new Map<string, number>();
  const pred = new Map<string, string | null>();
  for (const node of nodes) {
    dist.set(node.key, node.hours);
    pred.set(node.key, null);
  }
  for (const key of topo) {
    const base = dist.get(key) ?? 0;
    for (const next of outgoing.get(key) ?? []) {
      const candidate = base + (weight.get(next) ?? 0);
      if (candidate > (dist.get(next) ?? 0) + EPS) {
        dist.set(next, candidate);
        pred.set(next, key);
      }
    }
  }
  let bestKey = nodes[0]?.key ?? null;
  let best = -1;
  for (const [key, value] of dist) {
    if (value > best) {
      best = value;
      bestKey = key;
    }
  }
  const path: string[] = [];
  let cursor = bestKey;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    path.push(cursor);
    cursor = pred.get(cursor) ?? null;
  }
  path.reverse();
  return { cycle: false, hours: best < 0 ? 0 : best, path };
}

function paint(scheduleStart: number, scheduleEnd: number, marker: ScheduleMarker): Pick<
  Placed,
  "start" | "end" | "startFraction" | "endFraction"
> {
  const zero = Math.abs(scheduleEnd - scheduleStart) < EPS;
  const start = dateAtIndex(scheduleStart);
  if (marker === "unestimated") {
    return { start: start.date, end: start.date, startFraction: 0, endFraction: 1 };
  }
  const end = inclusiveEnd(scheduleEnd, zero);
  return {
    start: start.date,
    end: end.date,
    startFraction: start.fraction,
    endFraction: end.fraction,
  };
}

function laterDate(
  left: { date: string; fraction: number },
  right: { date: string; fraction: number },
): { date: string; fraction: number } {
  if (left.date !== right.date) return left.date > right.date ? left : right;
  return left.fraction >= right.fraction ? left : right;
}

function earlierDate(
  left: { date: string; fraction: number },
  right: { date: string; fraction: number },
): { date: string; fraction: number } {
  if (left.date !== right.date) return left.date < right.date ? left : right;
  return left.fraction <= right.fraction ? left : right;
}

/**
 * Places each plan item on working days. An undelayed critical chain ends on the
 * same date `projectPlanFinish` reports as `criticalPathFinish`.
 */
export function schedulePlan(input: SchedulePlanInput): SchedulePlan {
  const today = utcDate(input.now);
  const visible = input.items.filter(counted);
  const leaves = leavesOf(visible);
  const byKey = new Map(visible.map((item) => [itemKey(item), item]));
  const remaining = new Map(visible.map((item) => [itemKey(item), remainingOf(item, leaves)]));
  const childKeys = new Map<string, string[]>();
  for (const item of visible) {
    const key = itemKey(item);
    if (!childKeys.has(key)) childKeys.set(key, []);
    if (!item.parent) continue;
    const parentKey = itemKey(item.parent);
    if (!byKey.has(parentKey)) continue;
    const kids = childKeys.get(parentKey) ?? [];
    kids.push(key);
    childKeys.set(parentKey, kids);
  }
  const bracketKeys = new Set(
    [...childKeys.entries()].filter(([, kids]) => kids.length > 0).map(([key]) => key),
  );

  const edges = input.dependencies
    .filter((edge) => byKey.has(itemKey(edge.prerequisite)) && byKey.has(itemKey(edge.dependent)))
    .map((edge) => [itemKey(edge.prerequisite), itemKey(edge.dependent)] as [string, string]);
  const chain = longestChain(
    visible.map((item) => ({ key: itemKey(item), hours: remaining.get(itemKey(item)) ?? 0 })),
    edges,
  );
  const critical = new Set(chain.path);
  const planFloor = input.planStart != null && input.planStart > today ? input.planStart : today;
  const workStart = workingMorningsBefore(onOrAfterWeekday(planFloor));

  const prereqs = new Map<string, string[]>();
  for (const item of visible) prereqs.set(itemKey(item), []);
  for (const [from, to] of edges) prereqs.get(to)?.push(from);

  const placed = new Map<string, Placed>();

  const itemFloor = (item: ScheduleItemInput): number => {
    let date = planFloor;
    if (item.startDate != null && item.startDate > date) date = item.startDate;
    return workingMorningsBefore(onOrAfterWeekday(date));
  };

  const placeBar = (item: ScheduleItemInput, scheduleStart: number): Placed => {
    const key = itemKey(item);
    const hours = remaining.get(key) ?? 0;
    const marker: ScheduleMarker = item.estimateHours == null && !bracketKeys.has(key) ? "unestimated" : "bar";
    if (item.state === "complete" && item.completedAt) {
      const endDate = utcDate(new Date(item.completedAt));
      const startRaw = item.startedAt ? utcDate(new Date(item.startedAt)) : endDate;
      const startDate = startRaw > endDate ? endDate : startRaw;
      const nextDay = onOrAfterWeekday(addCalendarDays(endDate, 1));
      return {
        scheduleStart: workingMorningsBefore(startDate),
        scheduleEnd: workingMorningsBefore(nextDay),
        start: startDate,
        end: endDate,
        startFraction: 0,
        endFraction: 1,
        actual: true,
        marker: "bar",
        remainingHours: 0,
      };
    }
    if (marker === "unestimated") {
      const painted = paint(scheduleStart, scheduleStart, "unestimated");
      return {
        scheduleStart,
        scheduleEnd: scheduleStart,
        ...painted,
        actual: false,
        marker,
        remainingHours: 0,
      };
    }
    const duration = rawDuration(hours, input.workdayHours);
    const scheduleEnd = scheduleStart + duration;
    const painted = paint(scheduleStart, scheduleEnd, "bar");
    if (item.state === "in_progress" && item.startedAt) {
      const started = utcDate(new Date(item.startedAt));
      const visual =
        started < painted.start
          ? { date: started, fraction: 0 }
          : { date: painted.start, fraction: painted.startFraction };
      return {
        scheduleStart,
        scheduleEnd,
        start: visual.date,
        end: painted.end,
        startFraction: visual.fraction,
        endFraction: painted.endFraction,
        actual: true,
        marker: "bar",
        remainingHours: hours,
      };
    }
    return {
      scheduleStart,
      scheduleEnd,
      ...painted,
      actual: false,
      marker: "bar",
      remainingHours: hours,
    };
  };

  const order = topo(visible.map(itemKey), edges);
  const placeForward = (locked: Set<string>) => {
    for (const key of order) {
      if (locked.has(key) || bracketKeys.has(key)) continue;
      const item = byKey.get(key);
      if (!item) continue;
      const ends = (prereqs.get(key) ?? []).map((pred) => placed.get(pred)?.scheduleEnd ?? workStart);
      const scheduleStart = Math.max(itemFloor(item), workStart, ...ends);
      placed.set(key, placeBar(item, scheduleStart));
    }
  };

  placeForward(new Set());

  if (!chain.cycle && chain.path.length > 0) {
    let cursor = workStart;
    let packed = true;
    let rawEnd = workStart;
    for (const key of chain.path) {
      if ((remaining.get(key) ?? 0) <= EPS) continue;
      const row = placed.get(key);
      if (!row || Math.abs(row.scheduleStart - cursor) > 1e-4) {
        packed = false;
        break;
      }
      cursor = row.scheduleEnd;
      rawEnd = row.scheduleEnd;
    }
    const rawLen = rawEnd - workStart;
    const target =
      chain.hours == null || input.workdayHours <= 0 ? 0 : Math.round(chain.hours / input.workdayHours);
    const targetFinish = addWorkingDays(today, target);
    const rawFinish = inclusiveEnd(workStart + rawLen, rawLen <= EPS).date;
    if (packed && rawLen > EPS && rawFinish !== targetFinish) {
      const scale = target / rawLen;
      let prev = workStart;
      for (const key of chain.path) {
        const item = byKey.get(key);
        const row = placed.get(key);
        if (!item || !row || (row.actual && row.remainingHours <= EPS)) {
          prev = row?.scheduleEnd ?? prev;
          continue;
        }
        if ((remaining.get(key) ?? 0) <= EPS) {
          const painted = paint(prev, prev, row.marker === "unestimated" ? "unestimated" : "bar");
          placed.set(key, { ...row, scheduleStart: prev, scheduleEnd: prev, ...painted });
          continue;
        }
        const scheduleStart = workStart + (row.scheduleStart - workStart) * scale;
        const scheduleEnd = workStart + (row.scheduleEnd - workStart) * scale;
        const painted = paint(scheduleStart, scheduleEnd, "bar");
        let start = painted.start;
        let startFraction = painted.startFraction;
        if (item.state === "in_progress" && item.startedAt) {
          const started = utcDate(new Date(item.startedAt));
          if (started < painted.start) {
            start = started;
            startFraction = 0;
          }
        }
        placed.set(key, {
          ...row,
          scheduleStart,
          scheduleEnd,
          start,
          end: painted.end,
          startFraction,
          endFraction: painted.endFraction,
        });
        prev = scheduleEnd;
      }
      placeForward(critical);
    }
  }

  const depthOf = (key: string, seen = new Set<string>()): number => {
    if (seen.has(key)) return 0;
    seen.add(key);
    const parent = byKey.get(key)?.parent;
    if (!parent || !byKey.has(itemKey(parent))) return 0;
    return depthOf(itemKey(parent), seen) + 1;
  };
  const placeBrackets = () => {
    const brackets = [...bracketKeys].sort((left, right) => depthOf(right) - depthOf(left));
    for (const key of brackets) {
      const item = byKey.get(key);
      const kids = (childKeys.get(key) ?? [])
        .map((child) => placed.get(child))
        .filter((row): row is Placed => row != null);
      if (!item || kids.length === 0) continue;
      let start = { date: kids[0]!.start, fraction: kids[0]!.startFraction };
      let end = { date: kids[0]!.end, fraction: kids[0]!.endFraction };
      let scheduleStart = kids[0]!.scheduleStart;
      let scheduleEnd = kids[0]!.scheduleEnd;
      for (const kid of kids) {
        start = earlierDate(start, { date: kid.start, fraction: kid.startFraction });
        end = laterDate(end, { date: kid.end, fraction: kid.endFraction });
        scheduleStart = Math.min(scheduleStart, kid.scheduleStart);
        scheduleEnd = Math.max(scheduleEnd, kid.scheduleEnd);
      }
      placed.set(key, {
        scheduleStart,
        scheduleEnd,
        start: start.date,
        end: end.date,
        startFraction: start.fraction,
        endFraction: end.fraction,
        actual: false,
        marker: "bracket",
        remainingHours: 0,
      });
    }
  };
  placeBrackets();
  placeForward(critical);
  placeBrackets();

  const projectEnd = chain.cycle
    ? Math.max(workStart, ...[...placed.values()].map((row) => row.scheduleEnd))
    : chainEnd(chain.path, placed, remaining, workStart);

  const slackOf = (key: string): number => {
    const row = placed.get(key);
    if (!row) return 0;
    if (row.actual && row.remainingHours <= EPS) return 0;
    const successors = edges.filter((edge) => edge[0] === key).map((edge) => edge[1]);
    let limit = projectEnd;
    for (const successor of successors) {
      const next = placed.get(successor);
      if (next) limit = Math.min(limit, next.scheduleStart);
    }
    const raw = limit - row.scheduleEnd;
    if (raw <= 1e-4) return 0;
    return Math.round(raw * 10) / 10;
  };

  const slack = new Map<string, number>();
  const leafish = [...placed.keys()].sort((left, right) => depthOf(left) - depthOf(right));
  for (const key of leafish) {
    if (bracketKeys.has(key)) {
      const kids = childKeys.get(key) ?? [];
      const values = kids.map((child) => slack.get(child) ?? slackOf(child));
      slack.set(key, values.length === 0 ? 0 : Math.min(...values));
    } else {
      slack.set(key, slackOf(key));
    }
  }

  const rows: ScheduleRow[] = visible
    .filter((item) => placed.has(itemKey(item)))
    .map((item) => {
      const key = itemKey(item);
      const row = placed.get(key)!;
      const prerequisiteKeys = prereqs.get(key) ?? [];
      const waitingOn = prerequisiteKeys.filter((pred) => {
        const other = byKey.get(pred);
        return other != null && !isDependencySatisfied(other.state);
      });
      return {
        key,
        entityType: item.entityType,
        entityId: item.entityId,
        phaseSort: item.phaseSort,
        itemSort: item.itemSort,
        parentKey: item.parent && byKey.has(itemKey(item.parent)) ? itemKey(item.parent) : null,
        state: item.state,
        estimateHours: item.estimateHours,
        remainingHours: row.remainingHours,
        dueDate: item.dueDate,
        start: row.start,
        end: row.end,
        startFraction: row.startFraction,
        endFraction: row.endFraction,
        actual: row.actual,
        marker: row.marker,
        critical: critical.has(key),
        slackDays: slack.get(key) ?? 0,
        prerequisiteKeys,
        waitingOn,
      };
    })
    .sort((left, right) => left.phaseSort - right.phaseSort || left.itemSort - right.itemSort || left.entityId - right.entityId);

  const workingDays =
    chain.cycle || chain.hours == null || input.workdayHours <= 0
      ? null
      : Math.round(chain.hours / input.workdayHours);
  return {
    anchor: today,
    workdayHours: input.workdayHours,
    criticalPathFinish: workingDays == null ? null : addWorkingDays(today, workingDays),
    cycle: chain.cycle,
    rows,
  };
}

function chainEnd(path: string[], placed: Map<string, Placed>, remaining: Map<string, number>, fallback: number): number {
  let end = fallback;
  for (const key of path) {
    if ((remaining.get(key) ?? 0) <= EPS) continue;
    const row = placed.get(key);
    if (row) end = Math.max(end, row.scheduleEnd);
  }
  return end;
}

function topo(keys: string[], edges: Array<[string, string]>): string[] {
  const indegree = new Map(keys.map((key) => [key, 0]));
  const outgoing = new Map<string, string[]>(keys.map((key) => [key, []]));
  for (const [from, to] of edges) {
    if (!indegree.has(from) || !indegree.has(to)) continue;
    outgoing.get(from)?.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }
  const queue = keys.filter((key) => (indegree.get(key) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const key = queue.shift();
    if (key == null) break;
    order.push(key);
    for (const next of outgoing.get(key) ?? []) {
      const degree = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  for (const key of keys) {
    if (!order.includes(key)) order.push(key);
  }
  return order;
}
