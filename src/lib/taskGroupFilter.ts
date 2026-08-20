/** Server-side validation of T0053 task-list filter JSON stored on task groups. */

const FILTER_FIELDS = ["state", "priority", "title", "number", "phase"] as const;
const FILTER_OPERATORS = ["is", "is_not", "contains", "starts_with"] as const;
const FILTER_JOINS = ["and", "or"] as const;

export type TaskGroupFilter = {
  clauses: { field: string; operator: string; value: string }[];
  joins: string[];
};

function isField(v: string): boolean {
  return (FILTER_FIELDS as readonly string[]).includes(v);
}
function isOperator(v: string): boolean {
  return (FILTER_OPERATORS as readonly string[]).includes(v);
}
function isJoin(v: string): boolean {
  return (FILTER_JOINS as readonly string[]).includes(v);
}

export function isEmptyTaskGroupFilter(
  filter: TaskGroupFilter | null | undefined,
): boolean {
  return !filter || filter.clauses.length === 0;
}

/** Parse unknown JSON into a filter, or null if empty/invalid. */
export function parseTaskGroupFilter(raw: unknown): TaskGroupFilter | null | "invalid" {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const obj = raw as { clauses?: unknown; joins?: unknown };
  if (!Array.isArray(obj.clauses)) return "invalid";
  if (obj.clauses.length === 0) return null;
  const clauses: TaskGroupFilter["clauses"] = [];
  for (const c of obj.clauses) {
    if (!c || typeof c !== "object") return "invalid";
    const row = c as Record<string, unknown>;
    if (
      typeof row.field !== "string" ||
      !isField(row.field) ||
      typeof row.operator !== "string" ||
      !isOperator(row.operator) ||
      typeof row.value !== "string"
    ) {
      return "invalid";
    }
    clauses.push({ field: row.field, operator: row.operator, value: row.value });
  }
  const joinsRaw = Array.isArray(obj.joins) ? obj.joins : [];
  const joins: string[] = [];
  for (let i = 0; i < Math.max(0, clauses.length - 1); i++) {
    const j = joinsRaw[i];
    joins.push(typeof j === "string" && isJoin(j) ? j : "and");
  }
  return { clauses, joins };
}
