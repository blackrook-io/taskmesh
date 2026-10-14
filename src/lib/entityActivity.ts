/** Fields Mesh treats as a record's last update. Comments are never one of these. */
export const ACTIVITY_UPDATE_FIELDS = ["state", "progress", "status", "body", "ai_access", "ai_local_only"] as const;

export type ActivityUpdateField = (typeof ACTIVITY_UPDATE_FIELDS)[number];

export type LastUpdate = {
  at: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

export type LastComment = {
  at: string;
  excerpt: string;
  withUpdate: boolean;
};

export type LastActivity = {
  lastUpdate: LastUpdate | null;
  lastComment: LastComment | null;
};

/** Same actor, posted within this many milliseconds of the update, counts as together. */
export const COMMENT_WITH_UPDATE_MS = 120_000;

export const COMMENT_EXCERPT_LENGTH = 160;

const STATE_LABELS: Record<string, string> = {
  new: "Draft",
  blocked: "Blocked",
  ready: "Ready",
  in_progress: "In Progress",
  pending: "Pending",
  complete: "Complete",
  canceled: "Canceled",
  on_hold: "On Hold",
  deleted: "Deleted",
};

const PROJECT_STATUS_LABELS: Record<string, string> = {
  idea: "Idea",
  active: "Active",
  paused: "Paused",
  done: "Done",
};

export function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

export function projectStatusLabel(status: string): string {
  return PROJECT_STATUS_LABELS[status] ?? status;
}

function hoursLabel(value: number | null | undefined): string {
  if (value == null) return "none";
  return String(value);
}

export function trackedTodoChanges(
  before: {
    state: string;
    progress: number;
    estimateHours?: number | null;
    startDate?: string | null;
  },
  after: {
    state: string;
    progress: number;
    estimateHours?: number | null;
    startDate?: string | null;
  },
): Array<{
  field: "state" | "progress" | "estimateHours" | "startDate";
  oldValue: string;
  newValue: string;
}> {
  const changes: Array<{
    field: "state" | "progress" | "estimateHours" | "startDate";
    oldValue: string;
    newValue: string;
  }> = [];
  if (before.state !== after.state) {
    changes.push({
      field: "state",
      oldValue: stateLabel(before.state),
      newValue: stateLabel(after.state),
    });
  }
  if (before.progress !== after.progress) {
    changes.push({
      field: "progress",
      oldValue: String(before.progress),
      newValue: String(after.progress),
    });
  }
  if (
    before.estimateHours !== undefined &&
    after.estimateHours !== undefined &&
    before.estimateHours !== after.estimateHours
  ) {
    changes.push({
      field: "estimateHours",
      oldValue: hoursLabel(before.estimateHours),
      newValue: hoursLabel(after.estimateHours),
    });
  }
  if (
    before.startDate !== undefined &&
    after.startDate !== undefined &&
    before.startDate !== after.startDate
  ) {
    changes.push({
      field: "startDate",
      oldValue: before.startDate && before.startDate !== "" ? before.startDate : "none",
      newValue: after.startDate && after.startDate !== "" ? after.startDate : "none",
    });
  }
  return changes;
}

export function trackedStatusChange(
  before: string,
  after: string,
): { field: "status"; oldValue: string; newValue: string } | null {
  if (before === after) return null;
  return {
    field: "status",
    oldValue: projectStatusLabel(before),
    newValue: projectStatusLabel(after),
  };
}

export function trackedAiAccessChange(
  before: string,
  after: string,
): { field: "ai_access"; oldValue: string; newValue: string } | null {
  if (before === after) return null;
  return {
    field: "ai_access",
    oldValue: before,
    newValue: after,
  };
}

export function trackedAiLocalOnlyChange(
  before: boolean,
  after: boolean,
): { field: "ai_local_only"; oldValue: string; newValue: string } | null {
  if (before === after) return null;
  return {
    field: "ai_local_only",
    oldValue: before ? "true" : "false",
    newValue: after ? "true" : "false",
  };
}

/** True when a markdown document body should record a `body` change (no diff stored). */
export function documentBodyChanged(before: string | null, after: string | null): boolean {
  return before !== after;
}

export function commentExcerpt(body: string, max = COMMENT_EXCERPT_LENGTH): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

export function commentPairsWithUpdate(
  comment: { at: Date; actorId: number | null },
  update: { at: Date; actorId: number | null } | null,
  windowMs = COMMENT_WITH_UPDATE_MS,
): boolean {
  if (!update || comment.actorId == null || update.actorId == null) return false;
  if (comment.actorId !== update.actorId) return false;
  return Math.abs(comment.at.getTime() - update.at.getTime()) <= windowMs;
}

/** Newest item update. Equal timestamps keep the later entry in the list. */
export function deriveListLastUpdate<T extends LastUpdate>(updates: readonly (T | null)[]): T | null {
  let best: T | null = null;
  for (const update of updates) {
    if (!update) continue;
    if (!best || update.at >= best.at) best = update;
  }
  return best;
}

/**
 * Stale clock for a graph node. Any recorded update (state, progress, status, or
 * document body) counts. A missing update leaves the record's createdAt.
 */
export function activityForGraphNode(
  activity: LastActivity | undefined,
  createdAt: string | null,
): LastActivity & { signalAt: string | null } {
  const lastUpdate = activity?.lastUpdate ?? null;
  const lastComment = activity?.lastComment ?? null;
  return {
    lastUpdate,
    lastComment,
    signalAt: lastUpdate?.at ?? createdAt,
  };
}
