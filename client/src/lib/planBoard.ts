import { formatEntityRef } from "./entityRef";

export type PlanEntityType = "task" | "todo";

export type PlanBlockerRef = {
  id: number;
  number: number;
  title: string;
  state: string;
};

export type PlanItemActions = {
  canCheck: boolean;
  canStart: boolean;
  canStartAndComplete: boolean;
  canUncheck: boolean;
  blockedBy: PlanBlockerRef[];
};

export type PlanBoardItem = {
  id: number;
  entityType: PlanEntityType;
  entityId: number;
  number: number;
  title: string;
  state: string;
  estimateHours: number | null;
  progress: number | null;
  dueDate: string | null;
  startDate: string | null;
  parentId: number | null;
  assignee: { id: number; referenceId: string; displayName: string } | null;
  sortOrder: number;
  actions: PlanItemActions;
  externalBlockers: PlanBlockerRef[];
};

export type PlanRollupSlice = {
  hoursTotal: number;
  hoursDone: number;
  progress: number;
  progressMode: "hours" | "count";
  itemCount: number;
  itemsDone: number;
  unestimatedCount: number;
};

export type PlanBoardPhase = {
  id: number;
  name: string;
  color: string | null;
  sortOrder: number;
  rollup: PlanRollupSlice;
  items: PlanBoardItem[];
};

export type PlanBoardEdge = {
  prerequisite: { entityType: PlanEntityType; entityId: number };
  dependent: { entityType: PlanEntityType; entityId: number };
};

export type PlanBoard = {
  plan: {
    id: number;
    number: number;
    projectId: number | null;
    title: string;
    revision: number;
  };
  rollup: PlanRollupSlice;
  permissions: { canWriteItems: boolean };
  phases: PlanBoardPhase[];
  edges: PlanBoardEdge[];
};

const EXCLUDED_STATES = new Set(["canceled", "deleted"]);

export type PlanCheckAction =
  | { kind: "disabled" }
  | { kind: "complete" }
  | { kind: "uncheck"; to: "ready" | "in_progress"; needsComment: boolean }
  | { kind: "ready-menu"; startAndComplete: boolean; blockers: PlanBlockerRef[] };

export type PlanHoursDisplay = {
  hours: number | null;
  editable: boolean;
};

function itemKey(item: { entityType: string; entityId: number }): string {
  return `${item.entityType}:${item.entityId}`;
}

function countedChildren(items: readonly PlanBoardItem[], item: PlanBoardItem): PlanBoardItem[] {
  return items.filter(
    (candidate) =>
      candidate.entityType === item.entityType &&
      candidate.parentId === item.entityId &&
      !EXCLUDED_STATES.has(candidate.state),
  );
}

function leavesUnder(items: readonly PlanBoardItem[], item: PlanBoardItem): PlanBoardItem[] {
  const children = countedChildren(items, item);
  if (children.length === 0) return [];
  const leaves: PlanBoardItem[] = [];
  for (const child of children) {
    const nested = leavesUnder(items, child);
    if (nested.length === 0) leaves.push(child);
    else leaves.push(...nested);
  }
  return leaves;
}

/** How many in-phase ancestors sit above this row. Pass only that phase's items. */
export function planIndentDepth(items: readonly PlanBoardItem[], item: PlanBoardItem): number {
  const byKey = new Map(items.map((row) => [itemKey(row), row]));
  let depth = 0;
  let current = item;
  const seen = new Set<string>();
  while (current.parentId != null && depth < 20) {
    const parentKey = `${current.entityType}:${current.parentId}`;
    if (seen.has(parentKey)) break;
    seen.add(parentKey);
    const parent = byKey.get(parentKey);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

/** Parent rows show counted descendant hours and cannot be edited. */
export function planRowHours(items: readonly PlanBoardItem[], item: PlanBoardItem): PlanHoursDisplay {
  const leaves = leavesUnder(items, item);
  if (leaves.length === 0) {
    return { hours: item.estimateHours, editable: true };
  }
  let total = 0;
  let any = false;
  for (const leaf of leaves) {
    if (leaf.estimateHours == null) continue;
    any = true;
    total += leaf.estimateHours;
  }
  return { hours: any ? Math.round(total * 4) / 4 : null, editable: false };
}

/** Which checkbox control the server flags allow. Start wins when both could apply. */
export function planCheckAction(item: Pick<PlanBoardItem, "entityType" | "actions">): PlanCheckAction {
  const actions = item.actions;
  if (actions.canStart) {
    return {
      kind: "ready-menu",
      startAndComplete: actions.canStartAndComplete,
      blockers: actions.blockedBy,
    };
  }
  if (actions.canCheck) return { kind: "complete" };
  if (actions.canUncheck) {
    if (item.entityType === "todo") {
      return { kind: "uncheck", to: "in_progress", needsComment: false };
    }
    return { kind: "uncheck", to: "ready", needsComment: true };
  }
  return { kind: "disabled" };
}

export function planCheckboxChecked(item: Pick<PlanBoardItem, "state" | "actions">): boolean {
  if (item.state === "complete" || item.state === "pending") return true;
  return item.actions.canUncheck && item.state === "canceled";
}

export function planBlockerLabel(blockers: readonly PlanBlockerRef[]): string | null {
  if (blockers.length === 0) return null;
  const refs = blockers.map((blocker) => formatEntityRef("task", blocker.number));
  return `Blocked by ${refs.join(", ")}`;
}

export function formatPlanHours(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

export function planHoursSummary(hoursDone: number, hoursTotal: number): string {
  return `${formatPlanHours(hoursDone)} of ${formatPlanHours(hoursTotal)} h`;
}

export function planProgressPercent(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

export function planUnestimatedLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 item unestimated" : `${count} items unestimated`;
}

export function planPhaseAccent(color: string | null): string | null {
  if (!color) return null;
  return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : null;
}

export function planPhaseCollapseKey(userId: number, planId: number): string {
  return `plan-phase-collapsed:${userId}:${planId}`;
}

export function readCollapsedPhaseIds(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0);
  } catch {
    return [];
  }
}

export function planItemRef(item: Pick<PlanBoardItem, "entityType" | "number">): string {
  return formatEntityRef(item.entityType, item.number);
}
