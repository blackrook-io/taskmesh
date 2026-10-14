/**
 * States that no longer block a Depends-on.
 * Keep in sync with client/src/lib/dependencySatisfied.ts.
 */
export const SATISFIED_DEPENDENCY_STATES = new Set([
  "complete",
  "canceled",
  "deleted",
  "pending",
]);

/** True when a prerequisite no longer blocks the dependent. */
export function isDependencySatisfied(state: string): boolean {
  return SATISFIED_DEPENDENCY_STATES.has(state);
}
