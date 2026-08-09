import { z } from "zod";

export const TASK_STATES = [
  "new",
  "ready",
  "in_progress",
  "complete",
  "canceled",
  "on_hold",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const TASK_PRIORITIES = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const taskStateSchema = z.enum(TASK_STATES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);

/** YYYY-MM-DD only. */
export const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD")
  .nullable()
  .optional();

/** Display form: T + zero-padded number (at least 4 digits). */
export function formatTaskNumber(n: number): string {
  return `T${String(n).padStart(4, "0")}`;
}
