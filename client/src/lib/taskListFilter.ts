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

export const FILTER_FIELDS = ["state", "priority", "title", "number", "phase", "tags", "project"] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

export const FILTER_OPERATORS = ["is", "is_not", "contains", "does_not_contain", "starts_with"] as const;
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
  phase: "Phase",
  tags: "Tags",
  project: "Project",
};

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  does_not_contain: "does not contain",
  starts_with: "starts with",
};

export const FILTER_JOIN_LABELS: Record<FilterJoin, string> = {
  and: "AND",
  or: "OR",
};

export function defaultValueForField(field: FilterField): string {
  if (field === "state") return "new";
  if (field === "priority") return "none";
  return "";
}

export function defaultOperatorForField(field: FilterField): FilterOperator {
  if (field === "tags") return "contains";
  return "is";
}

/** Tags use membership language; other fields keep the full operator set. */
export function operatorsForField(field: FilterField): readonly FilterOperator[] {
  if (field === "tags") return ["contains", "does_not_contain", "starts_with"];
  return FILTER_OPERATORS;
}

export function filterFieldsForScope(includeProject: boolean): readonly FilterField[] {
  if (includeProject) return FILTER_FIELDS;
  return FILTER_FIELDS.filter((f) => f !== "project");
}

export function clauseValueUsesPicker(field: FilterField, operator: FilterOperator): boolean {
  if (field === "state" || field === "priority") return true;
  if (field === "tags") return operator === "contains" || operator === "does_not_contain";
  if (field === "phase" || field === "project") return operator === "is" || operator === "is_not";
  return false;
}

export function applyClausePatch(clause: FilterClause, patch: Partial<FilterClause>): FilterClause {
  const next: FilterClause = { ...clause, ...patch };
  if (patch.field && patch.field !== clause.field) {
    const allowed = operatorsForField(next.field);
    if (!allowed.includes(next.operator)) {
      next.operator = defaultOperatorForField(next.field);
    }
    next.value = defaultValueForField(next.field);
  } else if (patch.operator && patch.operator !== clause.operator) {
    const before = clauseValueUsesPicker(clause.field, clause.operator);
    const after = clauseValueUsesPicker(next.field, next.operator);
    if (before !== after) {
      next.value = defaultValueForField(next.field);
    }
  }
  return next;
}

/** Lookups for Phase / Tags / Project clauses (id → label, per-task tags). */
export type FilterMatchContext = {
  phaseNames?: ReadonlyMap<number, string>;
  tagNames?: ReadonlyMap<number, string>;
  /** Tags attached to each task id. */
  taskTags?: ReadonlyMap<number, readonly { id: number; name: string }[]>;
  projectNames?: ReadonlyMap<number, string>;
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
    case "does_not_contain":
      return !h.includes(n);
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
  if (operator === "does_not_contain") {
    return !(matchText(display, value, "contains") || matchText(digits, value, "contains"));
  }
  return matchText(display, value, "starts_with") || matchText(digits, value, "starts_with");
}

function fieldHaystacks(task: Task, field: FilterField, ctx?: FilterMatchContext): string[] {
  switch (field) {
    case "state":
      return [task.state, TASK_STATE_LABELS[task.state]];
    case "priority":
      return [task.priority, TASK_PRIORITY_LABELS[task.priority]];
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
  }
}

function matchPhase(task: Task, clause: FilterClause, ctx?: FilterMatchContext): boolean {
  const value = clause.value.trim();
  const noneWanted = value === "" || foldCase(value) === "none";
  if (clause.operator === "is" || clause.operator === "is_not") {
    const eq = noneWanted
      ? task.phaseId == null
      : task.phaseId != null && String(task.phaseId) === value;
    return clause.operator === "is" ? eq : !eq;
  }
  const haystacks = fieldHaystacks(task, "phase", ctx);
  if (clause.operator === "does_not_contain") {
    if (!value) return true;
    return !haystacks.some((h) => matchText(h, value, "contains"));
  }
  if (!value) return false;
  return haystacks.some((h) => matchText(h, value, clause.operator));
}

function noneValue(value: string): boolean {
  return value === "" || foldCase(value) === "none";
}

function matchTags(task: Task, clause: FilterClause, ctx?: FilterMatchContext): boolean {
  const tags = ctx?.taskTags?.get(task.id) ?? [];
  const value = clause.value.trim();
  const op = clause.operator;

  if (op === "starts_with") {
    if (!value) return false;
    return tags.some((t) => matchText(t.name, value, "starts_with"));
  }

  const has =
    noneValue(value) ? tags.length === 0 : tags.some((t) => String(t.id) === value);
  if (op === "contains" || op === "is") return has;
  if (op === "does_not_contain" || op === "is_not") return !has;
  return tags.some((t) => matchText(t.name, value, op));
}

function matchProject(task: Task, clause: FilterClause, ctx?: FilterMatchContext): boolean {
  const value = clause.value.trim();
  if (clause.operator === "is" || clause.operator === "is_not") {
    const eq = noneValue(value)
      ? task.projectId == null
      : task.projectId != null && String(task.projectId) === value;
    return clause.operator === "is" ? eq : !eq;
  }
  const haystacks = fieldHaystacks(task, "project", ctx);
  if (clause.operator === "does_not_contain") {
    if (!value) return true;
    return !haystacks.some((h) => matchText(h, value, "contains"));
  }
  if (!value) return false;
  return haystacks.some((h) => matchText(h, value, clause.operator));
}

export function clauseMatchesTask(
  task: Task,
  clause: FilterClause,
  ctx?: FilterMatchContext,
): boolean {
  const value = clause.value.trim();
  if (clause.field === "phase") {
    return matchPhase(task, clause, ctx);
  }
  if (clause.field === "tags") {
    return matchTags(task, clause, ctx);
  }
  if (clause.field === "project") {
    return matchProject(task, clause, ctx);
  }
  if (clause.field === "number") {
    if (!value) {
      if (clause.operator === "is_not" || clause.operator === "does_not_contain") return true;
      return false;
    }
    return matchNumber(task.number, clause.value, clause.operator);
  }

  if (!value) {
    if (clause.operator === "is_not" || clause.operator === "does_not_contain") return true;
    return false;
  }

  const haystacks = fieldHaystacks(task, clause.field, ctx);

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
  if (clause.operator === "does_not_contain") {
    return !haystacks.some((h) => matchText(h, value, "contains"));
  }
  return haystacks.some((h) => matchText(h, value, clause.operator));
}

/** Left-to-right: ((c0 ⊕ c1) ⊕ c2) … */
export function taskMatchesFilter(
  task: Task,
  filter: TaskListFilter,
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

export function evaluateTaskListFilter(
  tasks: Task[],
  filter: TaskListFilter,
  ctx?: FilterMatchContext,
): Task[] {
  if (!isFilterActive(filter)) return tasks;
  return tasks.filter((t) => taskMatchesFilter(t, filter, ctx));
}

function clauseValueLabel(clause: FilterClause, ctx?: FilterMatchContext): string {
  if (clause.field === "state" && (TASK_STATES as readonly string[]).includes(clause.value)) {
    return TASK_STATE_LABELS[clause.value as TaskState];
  }
  if (clause.field === "priority" && (TASK_PRIORITIES as readonly string[]).includes(clause.value)) {
    return TASK_PRIORITY_LABELS[clause.value as TaskPriority];
  }
  if (clause.field === "phase") {
    const raw = clause.value.trim();
    if (!raw || foldCase(raw) === "none") return "None";
    const id = Number(raw);
    if (Number.isFinite(id) && ctx?.phaseNames?.has(id)) {
      return ctx.phaseNames.get(id)!;
    }
    return raw;
  }
  if (clause.field === "tags") {
    const raw = clause.value.trim();
    if (!raw || foldCase(raw) === "none") return "None";
    const id = Number(raw);
    if (Number.isFinite(id) && ctx?.tagNames?.has(id)) {
      return ctx.tagNames.get(id)!;
    }
    return raw;
  }
  if (clause.field === "project") {
    const raw = clause.value.trim();
    if (!raw || foldCase(raw) === "none") return "None";
    const id = Number(raw);
    if (Number.isFinite(id) && ctx?.projectNames?.has(id)) {
      return ctx.projectNames.get(id)!;
    }
    return raw;
  }
  return clause.value.trim() || "∅";
}

export function formatFilterBreadcrumb(filter: TaskListFilter, ctx?: FilterMatchContext): string {
  if (!isFilterActive(filter)) return "";
  const parts: string[] = [];
  filter.clauses.forEach((clause, i) => {
    if (i > 0) {
      parts.push(FILTER_JOIN_LABELS[filter.joins[i - 1] ?? "and"]);
    }
    parts.push(
      `${FILTER_FIELD_LABELS[clause.field]} ${FILTER_OPERATOR_LABELS[clause.operator]} ${clauseValueLabel(clause, ctx)}`,
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
