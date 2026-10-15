import { formatEntityRef } from "./entityRef.js";

export type PlanCandidateType = "task" | "todo";

/** Title substring, `T####` / `D####`, or the bare number. An empty query matches everything. */
export function planCandidateMatches(
  entityType: PlanCandidateType,
  number: number,
  title: string,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (title.toLowerCase().includes(q)) return true;
  const ref = formatEntityRef(entityType, number).toLowerCase();
  if (ref.includes(q)) return true;
  const digits = q.replace(/^[a-z]+/, "");
  return /^\d+$/.test(digits) && number === Number(digits);
}
