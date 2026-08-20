/** Server-side task-list filter matching (aligned with client `taskListFilter.ts`). */

import { formatTaskNumber } from "./taskFields.js";
import type { TaskGroupFilter } from "./taskGroupFilter.js";

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

const PRIORITY_LABELS: Record<string, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export type TaskFilterSubject = {
  id: number;
  number: number;
  title: string;
  state: string;
  priority: string;
  phaseId: number | null;
  projectId: number | null;
};

export type FilterMatchContext = {
  phaseNames?: ReadonlyMap<number, string>;
  tagNames?: ReadonlyMap<number, string>;
  taskTags?: ReadonlyMap<number, readonly { id: number; name: string }[]>;
  projectNames?: ReadonlyMap<number, string>;
};

type FilterOperator = "is" | "is_not" | "contains" | "does_not_contain" | "starts_with";

function foldCase(s: string): string {
  return s.toLocaleLowerCase();
}

function matchText(haystack: string, needle: string, operator: FilterOperator): boolean {
  const h = foldCase(haystack);
  const n = foldCase(needle);
  switch (operator) {
    case "is":
      return h === n;
    case "is_not":
      return h !== n;
    case "contains":
      return h.includes(n);
    case "does_not_contain":
      return !h.includes(n);
    case "starts_with":
      return h.startsWith(n);
  }
}

function parseTaskNumberInput(value: string): number | null {
  const m = value.trim().match(/^t?0*(\d+)$/i);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function matchNumber(taskNumber: number, rawValue: string, operator: FilterOperator): boolean {
  const value = rawValue.trim();
  if (operator === "is" || operator === "is_not") {
    const parsed = parseTaskNumberInput(value);
    const eq =
      parsed != null
        ? taskNumber === parsed
        : foldCase(formatTaskNumber(taskNumber)) === foldCase(value);
    return operator === "is" ? eq : !eq;
  }
  const display = formatTaskNumber(taskNumber);
  const digits = String(taskNumber);
  if (operator === "contains") {
    return matchText(display, value, "contains") || matchText(digits, value, "contains");
  }
  if (operator === "does_not_contain") {
    return !(matchText(display, value, "contains") || matchText(digits, value, "contains"));
  }
  return matchText(display, value, "starts_with") || matchText(digits, value, "starts_with");
}

function noneValue(value: string): boolean {
  return value === "" || foldCase(value) === "none";
}

function fieldHaystacks(
  task: TaskFilterSubject,
  field: string,
  ctx?: FilterMatchContext,
): string[] {
  switch (field) {
    case "state":
      return [task.state, STATE_LABELS[task.state] ?? task.state];
    case "priority":
      return [task.priority, PRIORITY_LABELS[task.priority] ?? task.priority];
    case "title":
      return [task.title];
    case "number":
      return [formatTaskNumber(task.number), String(task.number)];
    case "phase": {
      if (task.phaseId == null) return ["none", ""];
      const name = ctx?.phaseNames?.get(task.phaseId) ?? "";
      return [name, String(task.phaseId)].filter((s) => s.length > 0);
    }
    case "tags":
      return (ctx?.taskTags?.get(task.id) ?? []).map((t) => t.name);
    case "project": {
      if (task.projectId == null) return ["none", ""];
      const name = ctx?.projectNames?.get(task.projectId) ?? "";
      return [name, String(task.projectId)].filter((s) => s.length > 0);
    }
    default:
      return [];
  }
}

function matchPhase(
  task: TaskFilterSubject,
  clause: TaskGroupFilter["clauses"][number],
  ctx?: FilterMatchContext,
): boolean {
  const value = clause.value.trim();
  const op = clause.operator as FilterOperator;
  const noneWanted = noneValue(value);
  if (op === "is" || op === "is_not") {
    const eq = noneWanted
      ? task.phaseId == null
      : task.phaseId != null && String(task.phaseId) === value;
    return op === "is" ? eq : !eq;
  }
  const haystacks = fieldHaystacks(task, "phase", ctx);
  if (op === "does_not_contain") {
    if (!value) return true;
    return !haystacks.some((h) => matchText(h, value, "contains"));
  }
  if (!value) return false;
  return haystacks.some((h) => matchText(h, value, op));
}

function matchTags(
  task: TaskFilterSubject,
  clause: TaskGroupFilter["clauses"][number],
  ctx?: FilterMatchContext,
): boolean {
  const tags = ctx?.taskTags?.get(task.id) ?? [];
  const value = clause.value.trim();
  const op = clause.operator as FilterOperator;

  if (op === "starts_with") {
    if (!value) return false;
    return tags.some((t) => matchText(t.name, value, "starts_with"));
  }

  const has = noneValue(value) ? tags.length === 0 : tags.some((t) => String(t.id) === value);
  if (op === "contains" || op === "is") return has;
  if (op === "does_not_contain" || op === "is_not") return !has;
  return tags.some((t) => matchText(t.name, value, op));
}

function matchProject(
  task: TaskFilterSubject,
  clause: TaskGroupFilter["clauses"][number],
  ctx?: FilterMatchContext,
): boolean {
  const value = clause.value.trim();
  const op = clause.operator as FilterOperator;
  if (op === "is" || op === "is_not") {
    const eq = noneValue(value)
      ? task.projectId == null
      : task.projectId != null && String(task.projectId) === value;
    return op === "is" ? eq : !eq;
  }
  const haystacks = fieldHaystacks(task, "project", ctx);
  if (op === "does_not_contain") {
    if (!value) return true;
    return !haystacks.some((h) => matchText(h, value, "contains"));
  }
  if (!value) return false;
  return haystacks.some((h) => matchText(h, value, op));
}

function clauseMatchesTask(
  task: TaskFilterSubject,
  clause: TaskGroupFilter["clauses"][number],
  ctx?: FilterMatchContext,
): boolean {
  const value = clause.value.trim();
  const op = clause.operator as FilterOperator;
  if (clause.field === "phase") return matchPhase(task, clause, ctx);
  if (clause.field === "tags") return matchTags(task, clause, ctx);
  if (clause.field === "project") return matchProject(task, clause, ctx);
  if (clause.field === "number") {
    if (!value) {
      if (op === "is_not" || op === "does_not_contain") return true;
      return false;
    }
    return matchNumber(task.number, clause.value, op);
  }

  if (!value) {
    if (op === "is_not" || op === "does_not_contain") return true;
    return false;
  }

  const haystacks = fieldHaystacks(task, clause.field, ctx);

  if (clause.field === "state" || clause.field === "priority") {
    if (op === "is" || op === "is_not") {
      const key = clause.field === "state" ? task.state : task.priority;
      const eq = key === value;
      return op === "is" ? eq : !eq;
    }
  }

  if (op === "is") return haystacks.some((h) => matchText(h, value, "is"));
  if (op === "is_not") return haystacks.every((h) => matchText(h, value, "is_not"));
  if (op === "does_not_contain") return !haystacks.some((h) => matchText(h, value, "contains"));
  return haystacks.some((h) => matchText(h, value, op));
}

export function taskMatchesGroupFilter(
  task: TaskFilterSubject,
  filter: TaskGroupFilter,
  ctx?: FilterMatchContext,
): boolean {
  const { clauses, joins } = filter;
  if (clauses.length === 0) return true;
  let result = clauseMatchesTask(task, clauses[0]!, ctx);
  for (let i = 1; i < clauses.length; i++) {
    const join = joins[i - 1] ?? "and";
    const next = clauseMatchesTask(task, clauses[i]!, ctx);
    result = join === "or" ? result || next : result && next;
  }
  return result;
}
