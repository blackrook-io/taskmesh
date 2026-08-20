/** Client-side compound filters for task list views. */

import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATE_LABELS,
  TASK_STATES,
  formatTaskNumber,
  type TaskPriority,
  type TaskState,
} from "./taskFields";
import type { Task } from "../types";

export const FILTER_FIELDS = ["state", "priority", "title", "number"] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

export const FILTER_OPERATORS = ["is", "is_not", "contains", "starts_with"] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const FILTER_JOINS = ["and", "or"] as const;
export type FilterJoin = (typeof FILTER_JOINS)[number];

export type FilterClause = {
  field: FilterField;
  operator: FilterOperator;
  value: string;
};

/** Ordered clauses with joins[i] between clauses[i] and clauses[i + 1]. */
export type TaskListFilter = {
  clauses: FilterClause[];
  joins: FilterJoin[];
};

export const FILTER_FIELD_LABELS: Record<FilterField, string> = {
  state: "State",
  priority: "Priority",
  title: "Title",
  number: "Number",
};

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  starts_with: "starts with",
};

export const FILTER_JOIN_LABELS: Record<FilterJoin, string> = {
  and: "AND",
  or: "OR",
};

export function emptyTaskListFilter(): TaskListFilter {
  return { clauses: [], joins: [] };
}

export function newFilterClause(): FilterClause {
  return { field: "state", operator: "is", value: "new" };
}

export function isFilterActive(filter: TaskListFilter | null | undefined): boolean {
  return (filter?.clauses.length ?? 0) > 0;
}

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
    case "starts_with":
      return h.startsWith(n);
  }
}

/** Parse `53`, `T53`, `T0053` → integer; otherwise null. */
export function parseTaskNumberInput(value: string): number | null {
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
  return matchText(display, value, "starts_with") || matchText(digits, value, "starts_with");
}

function fieldHaystacks(task: Task, field: FilterField): string[] {
  switch (field) {
    case "state":
      return [task.state, TASK_STATE_LABELS[task.state]];
    case "priority":
      return [task.priority, TASK_PRIORITY_LABELS[task.priority]];
    case "title":
      return [task.title];
    case "number":
      return [formatTaskNumber(task.number), String(task.number)];
  }
}

export function clauseMatchesTask(task: Task, clause: FilterClause): boolean {
  const value = clause.value.trim();
  if (clause.field === "number") {
    if (!value && (clause.operator === "is" || clause.operator === "contains" || clause.operator === "starts_with")) {
      return false;
    }
    return matchNumber(task.number, clause.value, clause.operator);
  }

  if (!value) {
    if (clause.operator === "is_not") return true;
    return false;
  }

  const haystacks = fieldHaystacks(task, clause.field);

  if (clause.field === "state" || clause.field === "priority") {
    if (clause.operator === "is" || clause.operator === "is_not") {
      const key = clause.field === "state" ? task.state : task.priority;
      const eq = key === value;
      return clause.operator === "is" ? eq : !eq;
    }
  }

  if (clause.operator === "is") {
    return haystacks.some((h) => matchText(h, value, "is"));
  }
  if (clause.operator === "is_not") {
    return haystacks.every((h) => matchText(h, value, "is_not"));
  }
  return haystacks.some((h) => matchText(h, value, clause.operator));
}

/** Left-to-right: ((c0 ⊕ c1) ⊕ c2) … */
export function taskMatchesFilter(task: Task, filter: TaskListFilter): boolean {
  const { clauses, joins } = filter;
  if (clauses.length === 0) return true;
  let result = clauseMatchesTask(task, clauses[0]!);
  for (let i = 1; i < clauses.length; i++) {
    const join = joins[i - 1] ?? "and";
    const next = clauseMatchesTask(task, clauses[i]!);
    result = join === "or" ? result || next : result && next;
  }
  return result;
}

export function evaluateTaskListFilter(tasks: Task[], filter: TaskListFilter): Task[] {
  if (!isFilterActive(filter)) return tasks;
  return tasks.filter((t) => taskMatchesFilter(t, filter));
}

function clauseValueLabel(clause: FilterClause): string {
  if (clause.field === "state" && (TASK_STATES as readonly string[]).includes(clause.value)) {
    return TASK_STATE_LABELS[clause.value as TaskState];
  }
  if (clause.field === "priority" && (TASK_PRIORITIES as readonly string[]).includes(clause.value)) {
    return TASK_PRIORITY_LABELS[clause.value as TaskPriority];
  }
  return clause.value.trim() || "∅";
}

export function formatFilterBreadcrumb(filter: TaskListFilter): string {
  if (!isFilterActive(filter)) return "";
  const parts: string[] = [];
  filter.clauses.forEach((clause, i) => {
    if (i > 0) {
      parts.push(FILTER_JOIN_LABELS[filter.joins[i - 1] ?? "and"]);
    }
    parts.push(
      `${FILTER_FIELD_LABELS[clause.field]} ${FILTER_OPERATOR_LABELS[clause.operator]} ${clauseValueLabel(clause)}`,
    );
  });
  return parts.join(" ");
}

export function isFilterField(v: string): v is FilterField {
  return (FILTER_FIELDS as readonly string[]).includes(v);
}

export function isFilterOperator(v: string): v is FilterOperator {
  return (FILTER_OPERATORS as readonly string[]).includes(v);
}

export function isFilterJoin(v: string): v is FilterJoin {
  return (FILTER_JOINS as readonly string[]).includes(v);
}

function isValidClause(raw: unknown): raw is FilterClause {
  if (!raw || typeof raw !== "object") return false;
  const c = raw as Record<string, unknown>;
  return (
    typeof c.field === "string" &&
    isFilterField(c.field) &&
    typeof c.operator === "string" &&
    isFilterOperator(c.operator) &&
    typeof c.value === "string"
  );
}

export function parseStoredTaskListFilter(raw: string | null): TaskListFilter | null {
  if (raw == null || raw === "") return null;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return null;
    const obj = data as { clauses?: unknown; joins?: unknown };
    if (!Array.isArray(obj.clauses) || !obj.clauses.every(isValidClause)) return null;
    const clauses = obj.clauses as FilterClause[];
    const joinsRaw = Array.isArray(obj.joins) ? obj.joins : [];
    const joins: FilterJoin[] = [];
    for (let i = 0; i < Math.max(0, clauses.length - 1); i++) {
      const j = joinsRaw[i];
      joins.push(typeof j === "string" && isFilterJoin(j) ? j : "and");
    }
    return { clauses, joins };
  } catch {
    return null;
  }
}

export function parseTaskListFilterValue(data: unknown): TaskListFilter | null {
  if (data == null) return null;
  if (typeof data === "string") return parseStoredTaskListFilter(data);
  try {
    return parseStoredTaskListFilter(JSON.stringify(data));
  } catch {
    return null;
  }
}

export function storageKeyForProjectTasks(projectId: number): string {
  return `taskmesh.taskListFilter.project:${projectId}`;
}

export function storageKeyForGlobalTasks(scope: "all" | "unassigned"): string {
  return scope === "unassigned"
    ? "taskmesh.taskListFilter.global:unassigned"
    : "taskmesh.taskListFilter.global";
}

export function loadTaskListFilter(storageKey: string): TaskListFilter {
  try {
    const parsed = parseStoredTaskListFilter(localStorage.getItem(storageKey));
    return parsed ?? emptyTaskListFilter();
  } catch {
    return emptyTaskListFilter();
  }
}

export function saveTaskListFilter(storageKey: string, filter: TaskListFilter): void {
  try {
    if (!isFilterActive(filter)) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(filter));
  } catch {
    /* ignore quota / private mode */
  }
}
