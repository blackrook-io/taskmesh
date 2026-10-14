/** Quarter-hour effort estimates. Null means not estimated. 0 means trivial. */

export const ESTIMATE_HOURS_MAX = 999.75;

export function isQuarterHour(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const quarters = value * 4;
  return Math.abs(quarters - Math.round(quarters)) < 1e-6;
}

/**
 * Parse a form or spreadsheet cell.
 * Empty → null. A finite quarter-hour in range → that number. Anything else → invalid.
 */
export function parseEstimateHours(raw: unknown): number | null | "invalid" {
  if (raw == null) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0 || n > ESTIMATE_HOURS_MAX || !isQuarterHour(n)) {
    return "invalid";
  }
  return Math.round(n * 4) / 4;
}

export function formatEstimateHours(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "";
  return String(Math.round(value * 4) / 4);
}

export function estimateHoursMatches(
  hours: number | null | undefined,
  operator: string,
  rawValue: string,
): boolean {
  if (operator === "is_empty") return hours == null;
  if (operator === "is_not_empty") return hours != null;
  const target = parseEstimateHours(rawValue);
  if (target === "invalid" || target == null || hours == null) return false;
  if (operator === "is") return hours === target;
  if (operator === "gt") return hours > target;
  if (operator === "lt") return hours < target;
  return false;
}

/** Numeric compare. Unset values stay last in both directions. A tie returns 0. */
export function compareEstimateHours(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: 1 | -1,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}
