import { z } from "zod";

/** Hours in one working day on a plan. Used later as duration = estimate ÷ workday. */

export const WORKDAY_HOURS_MIN = 0.25;
export const WORKDAY_HOURS_MAX = 24;
export const WORKDAY_HOURS_DEFAULT = 8;

export function isQuarterHour(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const quarters = value * 4;
  return Math.abs(quarters - Math.round(quarters)) < 1e-6;
}

/** Required on a plan. Omitted on create means the column default of 8. */
export const workdayHoursSchema = z
  .number()
  .min(WORKDAY_HOURS_MIN)
  .max(WORKDAY_HOURS_MAX)
  .refine(isQuarterHour, "workdayHours must be a quarter-hour from 0.25 to 24");

export function parseWorkdayHours(raw: unknown): number | "invalid" {
  if (raw == null) return "invalid";
  if (typeof raw === "string" && raw.trim() === "") return "invalid";
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (
    !Number.isFinite(n) ||
    n < WORKDAY_HOURS_MIN ||
    n > WORKDAY_HOURS_MAX ||
    !isQuarterHour(n)
  ) {
    return "invalid";
  }
  return Math.round(n * 4) / 4;
}
