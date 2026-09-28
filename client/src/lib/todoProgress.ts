/** Color band for a stored ToDo percent (T0155). */
export type TodoProgressBand = "red" | "orange" | "yellow" | "green";

export function todoProgressBand(progress: number): TodoProgressBand {
  if (progress <= 25) return "red";
  if (progress <= 50) return "orange";
  if (progress <= 75) return "yellow";
  return "green";
}

export function clampTodoProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}
