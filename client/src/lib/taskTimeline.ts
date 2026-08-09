/** Build State / Priority timeline nodes from task row + activity history. */

import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATES,
  TASK_STATE_LABELS,
  type TaskPriority,
  type TaskState,
} from "./taskFields";
import type { Task, TaskActivityEntry, UserRef } from "../types";

export type TimelineKind = "state" | "priority";

export type TimelineNode = {
  /** Stable key for React. */
  id: string;
  at: string;
  by: UserRef | null;
  /** Value after this node (state or priority during the following segment). */
  value: string;
  /** Previous value at this change; null for creation / anchor. */
  from: string | null;
  role: "creation" | "change" | "anchor" | "current";
};

export type TimelineLine = {
  kind: TimelineKind;
  nodes: TimelineNode[];
};

const STATE_BY_LABEL: Record<string, TaskState> = {
  ...Object.fromEntries(
    TASK_STATES.map((s) => [TASK_STATE_LABELS[s].toLowerCase(), s]),
  ),
  // Pre-Ready-state rename: older History rows labeled `new` as "New".
  new: "new",
} as Record<string, TaskState>;

const PRIORITY_BY_LABEL: Record<string, TaskPriority> = Object.fromEntries(
  TASK_PRIORITIES.map((p) => [TASK_PRIORITY_LABELS[p].toLowerCase(), p]),
) as Record<string, TaskPriority>;

type FieldTransition = {
  at: string;
  by: UserRef | null;
  from: string;
  to: string;
  entryId: number;
};

function parseLabeledPair(
  text: string,
  fieldLabel: string,
): { from: string; to: string } | null {
  const re = new RegExp(
    `${fieldLabel}:\\s*(.+?)\\s*(?:→|->)\\s*(.+?)(?:;|$)`,
    "i",
  );
  const m = text.match(re);
  if (!m?.[1] || !m[2]) return null;
  return { from: m[1].trim(), to: m[2].trim() };
}

function resolveState(raw: string): TaskState | null {
  const t = raw.trim();
  if ((TASK_STATES as readonly string[]).includes(t)) return t as TaskState;
  return STATE_BY_LABEL[t.toLowerCase()] ?? null;
}

function resolvePriority(raw: string): TaskPriority | null {
  const t = raw.trim();
  if ((TASK_PRIORITIES as readonly string[]).includes(t)) return t as TaskPriority;
  return PRIORITY_BY_LABEL[t.toLowerCase()] ?? null;
}

function extractTransitions(
  entries: TaskActivityEntry[],
  field: "state" | "priority",
): FieldTransition[] {
  const label = field === "state" ? "State" : "Priority";
  const resolve = field === "state" ? resolveState : resolvePriority;
  const out: FieldTransition[] = [];

  const sorted = [...entries]
    .filter((e) => e.kind === "change")
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        a.id - b.id,
    );

  for (const entry of sorted) {
    if (entry.field === field && entry.oldValue != null && entry.newValue != null) {
      const from = resolve(entry.oldValue);
      const to = resolve(entry.newValue);
      if (from && to && from !== to) {
        out.push({
          at: entry.createdAt,
          by: entry.createdBy ?? null,
          from,
          to,
          entryId: entry.id,
        });
      }
      continue;
    }

    const text =
      entry.field === "summary" && entry.body
        ? entry.body
        : entry.body && entry.field == null
          ? entry.body
          : null;
    if (!text) continue;

    const pair = parseLabeledPair(text, label);
    if (!pair) continue;
    const from = resolve(pair.from);
    const to = resolve(pair.to);
    if (!from || !to || from === to) continue;
    out.push({
      at: entry.createdAt,
      by: entry.createdBy ?? null,
      from,
      to,
      entryId: entry.id,
    });
  }

  return out;
}

function ms(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Time-proportional x in [0,1] with a floor so short gaps stay readable. */
export function layoutTimelinePositions(isoTimes: string[]): number[] {
  const n = isoTimes.length;
  if (n <= 0) return [];
  if (n === 1) return [0.5];

  const times = isoTimes.map(ms);
  const rawGaps: number[] = [];
  for (let i = 1; i < n; i++) {
    const dt = Math.max(0, times[i]! - times[i - 1]!);
    // Soften long spans; keep a floor so near-simultaneous nodes don't overlap.
    rawGaps.push(Math.max(1, Math.pow(dt / 60_000, 0.35)));
  }
  const sum = rawGaps.reduce((a, b) => a + b, 0) || 1;
  const positions = [0];
  let x = 0;
  for (const g of rawGaps) {
    x += g / sum;
    positions.push(x);
  }
  positions[positions.length - 1] = 1;
  return positions;
}

export function formatTimelineElapsed(fromIso: string, toIso: string): string {
  const a = ms(fromIso);
  const b = ms(toIso);
  const sec = Math.max(0, Math.round((b - a) / 1000));
  if (sec < 60) return sec <= 1 ? "1s" : `${sec}s`;
  const mins = Math.floor(sec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remM = mins % 60;
  if (hours < 48) return remM ? `${hours}h ${remM}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH ? `${days}d ${remH}h` : `${days}d`;
}

export function formatTimelineWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildStateLine(task: Task, entries: TaskActivityEntry[]): TimelineLine {
  const transitions = extractTransitions(entries, "state");

  let creationValue: TaskState = "new";
  if (transitions.length > 0) {
    creationValue = resolveState(transitions[0]!.from) ?? "new";
  } else {
    creationValue = task.state;
  }

  const nodes: TimelineNode[] = [
    {
      id: "state-creation",
      at: task.createdAt,
      by: task.createdBy ?? null,
      value: creationValue,
      from: null,
      role: "creation",
    },
  ];

  for (const tr of transitions) {
    const prev = nodes[nodes.length - 1]!;
    if (prev.value === tr.to) continue;
    nodes.push({
      id: `state-${tr.entryId}`,
      at: tr.at,
      by: tr.by,
      value: tr.to,
      from: tr.from,
      role: "change",
    });
  }

  const last = nodes[nodes.length - 1]!;
  if (last.value !== task.state) {
    nodes.push({
      id: "state-current",
      at: task.updatedAt,
      by: task.updatedBy ?? null,
      value: task.state,
      from: last.value,
      role: "current",
    });
  } else if (last.role !== "creation") {
    nodes[nodes.length - 1] = { ...last, role: "current" };
  }

  return { kind: "state", nodes };
}

function firstReadyAt(task: Task, stateTransitions: FieldTransition[]): string | null {
  for (const tr of stateTransitions) {
    if (tr.to === "ready") return tr.at;
  }
  // Created already Ready with no logged state change.
  if (task.state === "ready" && stateTransitions.length === 0) return task.createdAt;
  return null;
}

/**
 * Priority in effect at `atIso`, applying same-timestamp changes (Ready batch)
 * and ignoring nothing yet — caller filters the transition list.
 */
function priorityJustBefore(
  allPriority: FieldTransition[],
  atIso: string,
  fallback: TaskPriority,
): TaskPriority {
  const at = ms(atIso);
  let value: TaskPriority | null = null;
  for (const tr of allPriority) {
    if (ms(tr.at) < at) {
      value = resolvePriority(tr.to) ?? value;
    }
  }
  if (value != null) return value;
  const later = allPriority.find((tr) => ms(tr.at) >= at);
  if (later) return resolvePriority(later.from) ?? fallback;
  return fallback;
}

function buildPriorityLine(task: Task, entries: TaskActivityEntry[]): TimelineLine {
  const stateTransitions = extractTransitions(entries, "state");
  const allPriority = extractTransitions(entries, "priority");
  const readyAt = firstReadyAt(task, stateTransitions);

  if (!readyAt) {
    return {
      kind: "priority",
      nodes: [
        {
          id: "priority-current",
          at: task.createdAt,
          by: task.createdBy ?? null,
          value: task.priority,
          from: null,
          role: "current",
        },
      ],
    };
  }

  const readyMs = ms(readyAt);
  const post = allPriority.filter((tr) => ms(tr.at) >= readyMs);
  const beforeReady = priorityJustBefore(allPriority, readyAt, "none");

  const readyTr = stateTransitions.find((tr) => tr.to === "ready" && tr.at === readyAt);

  // Same-timestamp priority change at Ready: use that as the first visible change.
  const sameTs = post.filter((tr) => ms(tr.at) === readyMs);
  const later = post.filter((tr) => ms(tr.at) > readyMs);

  const nodes: TimelineNode[] = [];

  if (sameTs.length > 0) {
    const lastSame = sameTs[sameTs.length - 1]!;
    nodes.push({
      id: `priority-${lastSame.entryId}`,
      at: lastSame.at,
      by: lastSame.by,
      value: lastSame.to,
      from: lastSame.from,
      role: "change",
    });
  } else {
    nodes.push({
      id: "priority-ready",
      at: readyAt,
      by: readyTr?.by ?? task.createdBy ?? null,
      value: beforeReady,
      from: null,
      role: "anchor",
    });
  }

  for (const tr of later) {
    const prev = nodes[nodes.length - 1]!;
    if (tr.to === prev.value) continue;
    nodes.push({
      id: `priority-${tr.entryId}`,
      at: tr.at,
      by: tr.by,
      value: tr.to,
      from: tr.from,
      role: "change",
    });
  }

  const last = nodes[nodes.length - 1]!;
  if (last.value !== task.priority) {
    nodes.push({
      id: "priority-current",
      at: task.updatedAt,
      by: task.updatedBy ?? null,
      value: task.priority,
      from: last.value,
      role: "current",
    });
  } else {
    nodes[nodes.length - 1] = { ...last, role: "current" };
  }

  return { kind: "priority", nodes };
}

export function buildTaskTimelines(
  task: Task,
  entries: TaskActivityEntry[],
): { state: TimelineLine; priority: TimelineLine } {
  return {
    state: buildStateLine(task, entries),
    priority: buildPriorityLine(task, entries),
  };
}

export function timelineValueLabel(kind: TimelineKind, value: string): string {
  if (kind === "state") {
    return TASK_STATE_LABELS[value as TaskState] ?? value;
  }
  return TASK_PRIORITY_LABELS[value as TaskPriority] ?? value;
}
