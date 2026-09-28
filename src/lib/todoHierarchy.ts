import { isFinishedChildState } from "./taskFields.js";

export type TodoChildState = { state: string };

export type TodoRollup = {
  /** Direct children counted in x/y (not canceled, not deleted). */
  childCount: number;
  /** Those whose state is complete. */
  completeCount: number;
  /** `round(100 * completeCount / childCount)`, or 0 when nothing counts. */
  progress: number;
  /** True when at least one direct child is not deleted. */
  derived: boolean;
  /** True when every direct child is complete, canceled, or deleted. Empty is false. */
  allFinished: boolean;
};

export type TodoParentSnapshot = {
  state: string;
  progress: number;
};

export type TodoParentResult = {
  state: string;
  progress: number;
  membershipChecked: boolean | null;
};

/** x of y and percent from direct children. Canceled and deleted are left out of x/y. */
export function rollupFromChildren(children: TodoChildState[]): TodoRollup {
  const nonDeleted = children.filter((child) => child.state !== "deleted");
  const counted = nonDeleted.filter((child) => child.state !== "canceled");
  const childCount = counted.length;
  const completeCount = counted.filter((child) => child.state === "complete").length;
  const progress = childCount > 0 ? Math.round((100 * completeCount) / childCount) : 0;
  return {
    childCount,
    completeCount,
    progress,
    derived: nonDeleted.length > 0,
    allFinished: children.length > 0 && children.every((child) => isFinishedChildState(child.state)),
  };
}

/**
 * Next stored state and progress for a parent that still has sub-items.
 * `request` is a user edit. Omit it when reconciling after a child change.
 * Returns null when the row can stay as it is.
 */
export function resolveDerivedParent(
  parent: TodoParentSnapshot,
  rollup: TodoRollup,
  request?: { state?: string; progress?: number },
): TodoParentResult | null {
  if (!rollup.derived) return null;

  if (request?.state !== undefined) {
    if (request.state === "complete") {
      if (!rollup.allFinished) {
        return { state: "pending", progress: rollup.progress, membershipChecked: false };
      }
      return { state: "complete", progress: 100, membershipChecked: true };
    }
    return {
      state: request.state,
      progress: rollup.progress,
      membershipChecked: parent.state === "complete" ? false : null,
    };
  }

  if (request?.progress === 100) {
    if (!rollup.allFinished) {
      return { state: "pending", progress: rollup.progress, membershipChecked: false };
    }
    return { state: "complete", progress: 100, membershipChecked: true };
  }

  if (request?.progress !== undefined && parent.state === "complete") {
    return { state: "in_progress", progress: rollup.progress, membershipChecked: false };
  }

  if (parent.state === "pending" && rollup.allFinished) {
    return { state: "complete", progress: 100, membershipChecked: true };
  }
  if (parent.state === "complete" && !rollup.allFinished) {
    return { state: "in_progress", progress: rollup.progress, membershipChecked: false };
  }
  if (parent.state === "complete" && rollup.allFinished) {
    if (parent.progress !== 100) {
      return { state: "complete", progress: 100, membershipChecked: true };
    }
    return null;
  }
  if (parent.progress !== rollup.progress) {
    return { state: parent.state, progress: rollup.progress, membershipChecked: null };
  }
  return null;
}

/**
 * Reconcile a parent after a child was added, removed, or changed.
 * A parent with no remaining sub-items is a leaf again. Pending with no sub-items
 * returns to In Progress. Pending whose children are all finished (including
 * only deleted) becomes Complete.
 */
export function resolveParentAfterChildChange(
  parent: TodoParentSnapshot,
  rollup: TodoRollup,
): TodoParentResult | null {
  if (!rollup.derived) {
    if (parent.state === "pending" && rollup.allFinished) {
      return { state: "complete", progress: 100, membershipChecked: true };
    }
    if (parent.state === "pending") {
      return { state: "in_progress", progress: parent.progress, membershipChecked: null };
    }
    return null;
  }
  return resolveDerivedParent(parent, rollup);
}

/** True when a progress edit on a derived parent should be rejected. */
export function isRejectedDerivedProgress(
  parent: TodoParentSnapshot,
  rollup: TodoRollup,
  progress: number,
  state: string | undefined,
): boolean {
  if (!rollup.derived || state !== undefined) return false;
  if (progress === 100) return false;
  return parent.state !== "complete";
}
