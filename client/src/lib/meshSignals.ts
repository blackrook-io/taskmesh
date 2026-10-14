import { isDependencySatisfied } from "./dependencySatisfied.ts";
import { containmentParent, type MeshGraphEdge } from "./meshLayout";

export type MeshColorMode = "type" | "state" | "priority";

export type MeshSignalNode = {
  key: string;
  type?: string;
  state?: string | null;
  priority?: string | null;
  progress?: number | null;
  dueDate?: string | null;
  createdAt?: string | null;
  signalAt?: string | null;
};

export type MeshSchedule = {
  kind: "none" | "ok" | "overdue" | "risk";
  /** Days overdue, or days left. Null when the due date has no countdown. */
  days: number | null;
  /** Share of the created-to-due span already elapsed, when the record is at risk. */
  used: number | null;
};

const MS_DAY = 864e5;

function dueAtNoon(dueDate: string): Date {
  return new Date(`${dueDate}T12:00:00`);
}

/** In Progress and Complete share a hue with Draft and Ready, so they are hollow. */
export function stateAppearance(state: string | null | undefined): { color: string; hollow: boolean } {
  switch (state) {
    case "new":
      return { color: "var(--task-state-draft)", hollow: false };
    case "blocked":
      return { color: "var(--task-state-blocked)", hollow: false };
    case "in_progress":
      return { color: "var(--task-state-progress)", hollow: true };
    case "ready":
      return { color: "var(--task-state-ready)", hollow: false };
    case "complete":
      return { color: "var(--task-state-done)", hollow: true };
    case "pending":
      return { color: "var(--task-state-pending)", hollow: false };
    case "on_hold":
      return { color: "var(--task-state-hold)", hollow: false };
    case "canceled":
      return { color: "var(--task-state-canceled)", hollow: false };
    default:
      return { color: "var(--border)", hollow: true };
  }
}

export function glyphStyle(
  mode: MeshColorMode,
  node: MeshSignalNode,
): { color: string; hollow: boolean } {
  if (mode === "state") return stateAppearance(node.state);
  if (mode === "priority") {
    if (!node.priority || node.priority === "none") return { color: "var(--border)", hollow: true };
    return { color: `var(--task-priority-${node.priority})`, hollow: false };
  }
  return { color: `var(--mesh-type-${node.type ?? "task"})`, hollow: false };
}

export function schedule(node: MeshSignalNode, today: Date): MeshSchedule {
  if (!node.dueDate || node.state === "complete" || node.state === "canceled") {
    return { kind: "none", days: null, used: null };
  }
  const due = dueAtNoon(node.dueDate);
  const left = Math.round((due.getTime() - today.getTime()) / MS_DAY);
  if (left < 0) return { kind: "overdue", days: -left, used: null };
  if (node.createdAt && node.progress != null) {
    const start = new Date(node.createdAt).getTime();
    const span = due.getTime() - start;
    if (span > 0) {
      const frac = (today.getTime() - start) / span;
      if (frac - node.progress / 100 > 0.25) {
        return { kind: "risk", days: left, used: Math.round(frac * 100) };
      }
    }
  }
  return { kind: "ok", days: left, used: null };
}

export function isStale(node: MeshSignalNode, today: Date, staleDays: number): boolean {
  if (!node.signalAt || node.state === "complete") return false;
  const elapsed = (today.getTime() - new Date(node.signalAt).getTime()) / MS_DAY;
  return elapsed >= staleDays;
}

/** A depends-on line is blocking while the prerequisite is not satisfied. */
export function dependsBlocking(prerequisiteState: string | null | undefined): boolean {
  return !isDependencySatisfied(prerequisiteState ?? "");
}

/** Overdue descendants that are in the payload but not placed, counted on each placed ancestor. */
export function hiddenOverdueCounts(
  nodes: readonly MeshSignalNode[],
  edges: readonly MeshGraphEdge[],
  placed: ReadonlySet<string>,
  today: Date,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (placed.has(node.key)) continue;
    if (schedule(node, today).kind !== "overdue") continue;
    const seen = new Set<string>();
    let parent = containmentParent(node.key, edges);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      if (placed.has(parent)) counts.set(parent, (counts.get(parent) ?? 0) + 1);
      parent = containmentParent(parent, edges);
    }
  }
  return counts;
}
