/** Client-side compound filters for To Do list views. */

import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATE_LABELS,
  TASK_STATES,
  type TaskPriority,
  type TaskState,
} from "./taskFields";
import type { TodoListItem } from "../types";

export const TODO_FILTER_FIELDS = [
  "state",
  "priority",
  "dueDate",
  "tags",
  "title",
  "checked",
  "entityType",
] as const;
export type TodoFilterField = (typeof TODO_FILTER_FIELDS)[number];

export const TODO_FILTER_OPERATORS = [
  "is",
  "is_not",
  "contains",
  "does_not_contain",
  "starts_with",
  "before",
  "after",
] as const;
export type TodoFilterOperator = (typeof TODO_FILTER_OPERATORS)[number];

export const TODO_FILTER_JOINS = ["and", "or"] as const;
export type TodoFilterJoin = (typeof TODO_FILTER_JOINS)[number];

export const DUE_PRESETS = ["today", "soon", "this_week", "this_month"] as const;
export type DuePreset = (typeof DUE_PRESETS)[number];

export type TodoFilterClause = {
  field: TodoFilterField;
  operator: TodoFilterOperator;
  value: string;
};

export type TodoListFilter = {
  clauses: TodoFilterClause[];
  joins: TodoFilterJoin[];
};

export const TODO_FILTER_FIELD_LABELS: Record<TodoFilterField, string> = {
  state: "State",
  priority: "Priority",
  dueDate: "Due",
  tags: "Tags",
  title: "Title",
  checked: "Checked",
  entityType: "Type",
};

export const TODO_FILTER_OPERATOR_LABELS: Record<TodoFilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  does_not_contain: "does not contain",
  starts_with: "starts with",
  before: "before",
  after: "after",
};

export const TODO_FILTER_JOIN_LABELS: Record<TodoFilterJoin, string> = {
  and: "AND",
  or: "OR",
};

export const DUE_PRESET_LABELS: Record<DuePreset, string> = {
  today: "Today",
  soon: "Soon",
  this_week: "This Week",
  this_month: "This Month",
};

export const ENTITY_TYPE_FILTER_VALUES = ["todo", "task", "idea"] as const;
export const ENTITY_TYPE_FILTER_LABELS: Record<(typeof ENTITY_TYPE_FILTER_VALUES)[number], string> = {
  todo: "ToDo",
  task: "Task",
  idea: "Idea",
};

/** Inline State choices (Draft…On Hold); Pending shown only when current value is pending. */
export const INLINE_TODO_LIST_STATES = [
  "new",
  "ready",
  "in_progress",
  "complete",
  "canceled",
  "on_hold",
] as const;

export type TodoFilterMatchContext = {
  tagNames?: ReadonlyMap<number, string>;
  /** Tags keyed by `${entityType}:${entityId}`. */
  entityTags?: ReadonlyMap<string, readonly { id: number; name: string }[]>;
};

export function entityTagKey(entityType: string, entityId: number): string {
  return `${entityType}:${entityId}`;
}

export function emptyTodoListFilter(): TodoListFilter {
  return { clauses: [], joins: [] };
}

export function newTodoFilterClause(): TodoFilterClause {
  return { field: "state", operator: "is", value: "new" };
}

export function isTodoFilterActive(filter: TodoListFilter | null | undefined): boolean {
  return (filter?.clauses.length ?? 0) > 0;
}

export function defaultValueForTodoField(field: TodoFilterField): string {
  if (field === "state") return "new";
  if (field === "priority") return "none";
  if (field === "dueDate") return "today";
  if (field === "checked") return "true";
  if (field === "entityType") return "todo";
  return "";
}

export function defaultOperatorForTodoField(field: TodoFilterField): TodoFilterOperator {
  if (field === "tags") return "contains";
  if (field === "title") return "contains";
  if (field === "dueDate") return "is";
  return "is";
}

export function operatorsForTodoField(field: TodoFilterField): readonly TodoFilterOperator[] {
  if (field === "dueDate") return ["is", "is_not", "before", "after"];
  if (field === "tags") return ["contains", "does_not_contain", "starts_with"];
  if (field === "title") return ["contains", "does_not_contain", "starts_with", "is", "is_not"];
  if (field === "checked" || field === "entityType" || field === "state" || field === "priority") {
    return ["is", "is_not"];
  }
  return ["is", "is_not"];
}

export function clauseValueUsesTodoPicker(field: TodoFilterField, operator: TodoFilterOperator): boolean {
  if (field === "state" || field === "priority" || field === "dueDate" || field === "checked" || field === "entityType") {
    return true;
  }
  if (field === "tags") return operator === "contains" || operator === "does_not_contain";
  return false;
}

export function applyTodoClausePatch(
  clause: TodoFilterClause,
  patch: Partial<TodoFilterClause>,
): TodoFilterClause {
  const next: TodoFilterClause = { ...clause, ...patch };
  if (patch.field && patch.field !== clause.field) {
    const allowed = operatorsForTodoField(next.field);
    if (!allowed.includes(next.operator)) {
      next.operator = defaultOperatorForTodoField(next.field);
    }
    next.value = defaultValueForTodoField(next.field);
  } else if (patch.operator && patch.operator !== clause.operator) {
    const before = clauseValueUsesTodoPicker(clause.field, clause.operator);
    const after = clauseValueUsesTodoPicker(next.field, next.operator);
    if (before !== after) {
      next.value = defaultValueForTodoField(next.field);
    }
  }
  return next;
}

function foldCase(s: string): string {
  return s.toLocaleLowerCase();
}

function matchText(haystack: string, needle: string, operator: TodoFilterOperator): boolean {
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
    default:
      return false;
  }
}

function noneValue(value: string): boolean {
  return value === "" || foldCase(value) === "none";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar YYYY-MM-DD. */
export function toLocalDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? null;
}

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  dt.setDate(dt.getDate() + days);
  return toLocalDateKey(dt);
}

/** Monday–Sunday week containing `todayKey`. */
function weekBounds(todayKey: string): { start: string; end: string } {
  const [y, m, d] = todayKey.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  const day = dt.getDay(); // 0 Sun … 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = addDays(todayKey, mondayOffset);
  const end = addDays(start, 6);
  return { start, end };
}

function monthBounds(todayKey: string): { start: string; end: string } {
  const [y, m] = todayKey.split("-").map(Number);
  const start = `${y}-${pad2(m!)}-01`;
  const last = new Date(y!, m!, 0).getDate();
  const end = `${y}-${pad2(m!)}-${pad2(last)}`;
  return { start, end };
}

/**
 * Soon = today through +2 days (3 calendar days).
 * This Week = Mon–Sun containing today.
 * This Month = calendar month containing today.
 */
export function duePresetRange(
  preset: DuePreset,
  todayKey: string = toLocalDateKey(new Date()),
): { start: string; end: string } {
  if (preset === "today") return { start: todayKey, end: todayKey };
  if (preset === "soon") return { start: todayKey, end: addDays(todayKey, 2) };
  if (preset === "this_week") return weekBounds(todayKey);
  return monthBounds(todayKey);
}

export function isDuePreset(v: string): v is DuePreset {
  return (DUE_PRESETS as readonly string[]).includes(v);
}

function matchDue(
  dueDate: string | null | undefined,
  clause: TodoFilterClause,
  todayKey: string = toLocalDateKey(new Date()),
): boolean {
  const due = parseDateKey(dueDate);
  const preset = isDuePreset(clause.value) ? clause.value : "today";
  const range = duePresetRange(preset, todayKey);
  const op = clause.operator;

  if (!due) {
    if (op === "is_not") return true;
    return false;
  }

  if (op === "is") return due >= range.start && due <= range.end;
  if (op === "is_not") return !(due >= range.start && due <= range.end);
  if (op === "before") return due < range.start;
  if (op === "after") return due > range.end;
  return false;
}

function matchTags(
  item: TodoListItem,
  clause: TodoFilterClause,
  ctx?: TodoFilterMatchContext,
): boolean {
  const tags = ctx?.entityTags?.get(entityTagKey(item.entityType, item.entityId)) ?? [];
  const value = clause.value.trim();
  const op = clause.operator;

  if (op === "starts_with") {
    if (!value) return false;
    return tags.some((t) => matchText(t.name, value, "starts_with"));
  }

  const has = noneValue(value) ? tags.length === 0 : tags.some((t) => String(t.id) === value);
  if (op === "contains" || op === "is") return has;
  if (op === "does_not_contain" || op === "is_not") return !has;
  return tags.some((t) => matchText(t.name, value, op));
}

export function clauseMatchesTodoItem(
  item: TodoListItem,
  clause: TodoFilterClause,
  ctx?: TodoFilterMatchContext,
  todayKey?: string,
): boolean {
  const value = clause.value.trim();

  if (clause.field === "dueDate") {
    return matchDue(item.dueDate, clause, todayKey);
  }
  if (clause.field === "tags") {
    return matchTags(item, clause, ctx);
  }
  if (clause.field === "checked") {
    const want = value === "true" || foldCase(value) === "yes" || foldCase(value) === "checked";
    const eq = item.checked === want;
    return clause.operator === "is_not" ? !eq : eq;
  }
  if (clause.field === "entityType") {
    const eq = item.entityType === value;
    return clause.operator === "is_not" ? !eq : eq;
  }
  if (clause.field === "state") {
    const state = item.state ?? "";
    if (!value) {
      if (clause.operator === "is_not") return true;
      return false;
    }
    const eq = state === value;
    if (clause.operator === "is" || clause.operator === "is_not") {
      return clause.operator === "is" ? eq : !eq;
    }
  }
  if (clause.field === "priority") {
    const priority = item.priority ?? "none";
    if (!value) {
      if (clause.operator === "is_not") return true;
      return false;
    }
    const eq = priority === value;
    if (clause.operator === "is" || clause.operator === "is_not") {
      return clause.operator === "is" ? eq : !eq;
    }
  }
  if (clause.field === "title") {
    if (!value) {
      if (clause.operator === "is_not" || clause.operator === "does_not_contain") return true;
      return false;
    }
    if (clause.operator === "does_not_contain") {
      return !matchText(item.title, value, "contains");
    }
    return matchText(item.title, value, clause.operator);
  }

  return false;
}

export function todoItemMatchesFilter(
  item: TodoListItem,
  filter: TodoListFilter,
  ctx?: TodoFilterMatchContext,
  todayKey?: string,
): boolean {
  const { clauses, joins } = filter;
  if (clauses.length === 0) return true;
  let result = clauseMatchesTodoItem(item, clauses[0]!, ctx, todayKey);
  for (let i = 1; i < clauses.length; i++) {
    const join = joins[i - 1] ?? "and";
    const next = clauseMatchesTodoItem(item, clauses[i]!, ctx, todayKey);
    result = join === "or" ? result || next : result && next;
  }
  return result;
}

export function evaluateTodoListFilter(
  items: TodoListItem[],
  filter: TodoListFilter,
  ctx?: TodoFilterMatchContext,
  todayKey?: string,
): TodoListItem[] {
  if (!isTodoFilterActive(filter)) return items;
  return items.filter((i) => todoItemMatchesFilter(i, filter, ctx, todayKey));
}

function clauseValueLabel(clause: TodoFilterClause, ctx?: TodoFilterMatchContext): string {
  if (clause.field === "state" && (TASK_STATES as readonly string[]).includes(clause.value)) {
    return TASK_STATE_LABELS[clause.value as TaskState];
  }
  if (clause.field === "priority" && (TASK_PRIORITIES as readonly string[]).includes(clause.value)) {
    return TASK_PRIORITY_LABELS[clause.value as TaskPriority];
  }
  if (clause.field === "dueDate" && isDuePreset(clause.value)) {
    return DUE_PRESET_LABELS[clause.value];
  }
  if (clause.field === "checked") {
    return clause.value === "true" ? "Yes" : "No";
  }
  if (clause.field === "entityType") {
    const v = clause.value as (typeof ENTITY_TYPE_FILTER_VALUES)[number];
    return ENTITY_TYPE_FILTER_LABELS[v] ?? clause.value;
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
  return clause.value.trim() || "∅";
}

export function formatTodoFilterBreadcrumb(
  filter: TodoListFilter,
  ctx?: TodoFilterMatchContext,
): string {
  if (!isTodoFilterActive(filter)) return "";
  const parts: string[] = [];
  filter.clauses.forEach((clause, i) => {
    if (i > 0) {
      parts.push(TODO_FILTER_JOIN_LABELS[filter.joins[i - 1] ?? "and"]);
    }
    parts.push(
      `${TODO_FILTER_FIELD_LABELS[clause.field]} ${TODO_FILTER_OPERATOR_LABELS[clause.operator]} ${clauseValueLabel(clause, ctx)}`,
    );
  });
  return parts.join(" ");
}

function isTodoFilterField(v: string): v is TodoFilterField {
  return (TODO_FILTER_FIELDS as readonly string[]).includes(v);
}

function isTodoFilterOperator(v: string): v is TodoFilterOperator {
  return (TODO_FILTER_OPERATORS as readonly string[]).includes(v);
}

function isTodoFilterJoin(v: string): v is TodoFilterJoin {
  return (TODO_FILTER_JOINS as readonly string[]).includes(v);
}

function isValidClause(raw: unknown): raw is TodoFilterClause {
  if (!raw || typeof raw !== "object") return false;
  const c = raw as Record<string, unknown>;
  return (
    typeof c.field === "string" &&
    isTodoFilterField(c.field) &&
    typeof c.operator === "string" &&
    isTodoFilterOperator(c.operator) &&
    typeof c.value === "string"
  );
}

export function parseStoredTodoListFilter(raw: string | null): TodoListFilter | null {
  if (raw == null || raw === "") return null;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return null;
    const obj = data as { clauses?: unknown; joins?: unknown };
    if (!Array.isArray(obj.clauses) || !obj.clauses.every(isValidClause)) return null;
    const clauses = obj.clauses as TodoFilterClause[];
    const joinsRaw = Array.isArray(obj.joins) ? obj.joins : [];
    const joins: TodoFilterJoin[] = [];
    for (let i = 0; i < Math.max(0, clauses.length - 1); i++) {
      const j = joinsRaw[i];
      joins.push(typeof j === "string" && isTodoFilterJoin(j) ? j : "and");
    }
    return { clauses, joins };
  } catch {
    return null;
  }
}

export function storageKeyForTodoList(listId: number): string {
  return `taskmesh.todoListFilter.list:${listId}`;
}

export function loadTodoListFilter(storageKey: string): TodoListFilter {
  try {
    const parsed = parseStoredTodoListFilter(localStorage.getItem(storageKey));
    return parsed ?? emptyTodoListFilter();
  } catch {
    return emptyTodoListFilter();
  }
}

export function saveTodoListFilter(storageKey: string, filter: TodoListFilter): void {
  try {
    if (!isTodoFilterActive(filter)) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(filter));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Reorder `all` by moving among the filtered visible subset (TaskBoard-style). */
export function reorderVisibleAmongAll<T extends { id: number }>(
  all: T[],
  visible: T[],
  activeId: number,
  overId: number,
): T[] | null {
  const visibleIds = visible.map((i) => i.id);
  const oldIndex = visibleIds.indexOf(activeId);
  const newIndex = visibleIds.indexOf(overId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return null;

  const nextVisibleIds = [...visibleIds];
  const [moved] = nextVisibleIds.splice(oldIndex, 1);
  nextVisibleIds.splice(newIndex, 0, moved!);

  const visibleSet = new Set(visibleIds);
  const result: T[] = [];
  let vi = 0;
  for (const item of all) {
    if (visibleSet.has(item.id)) {
      const id = nextVisibleIds[vi++]!;
      const row = all.find((x) => x.id === id);
      if (row) result.push(row);
    } else {
      result.push(item);
    }
  }
  return result;
}
