/** Fields Mesh treats as a record's last update. Comments are never one of these. */
export const ACTIVITY_UPDATE_FIELDS = ["state", "progress", "status", "body"] as const;

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

export function trackedTodoChanges(
  before: { state: string; progress: number },
  after: { state: string; progress: number },
): Array<{ field: "state" | "progress"; oldValue: string; newValue: string }> {
  const changes: Array<{ field: "state" | "progress"; oldValue: string; newValue: string }> = [];
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
export function deriveListLastUpdate(updates: readonly (LastUpdate | null)[]): LastUpdate | null {
  let best: LastUpdate | null = null;
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
