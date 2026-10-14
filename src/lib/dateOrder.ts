/**
 * Start date versus due date (or a plan target date).
 * T0311 plan create/patch should call these helpers rather than restating the message.
 * A start date does not block workflow; this only rejects an inverted pair.
 */

export const START_AFTER_DUE_MESSAGE = "Start date cannot be after the due date.";
export const START_AFTER_TARGET_MESSAGE = "Start date cannot be after the target date.";

/** Null when the pair is allowed. A missing date on either side is allowed. Equal dates are allowed. */
export function dateOrderViolation(
  start: string | null | undefined,
  end: string | null | undefined,
  message: string = START_AFTER_DUE_MESSAGE,
): string | null {
  if (start == null || start === "" || end == null || end === "") return null;
  if (start > end) return message;
  return null;
}

/**
 * Calendar compare for list sort. Unset dates stay last in both directions.
 * A tie returns 0. The non-null compare already includes `dir`.
 */
export function compareOptionalYmd(
  a: string | null | undefined,
  b: string | null | undefined,
  dir: 1 | -1,
): number {
  const left = a ? a.slice(0, 10) : "";
  const right = b ? b.slice(0, 10) : "";
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right) * dir;
}
