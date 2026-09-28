import type { Tag } from "../types";
import { formatListDate } from "./listViewColumns";
import type { IdeaListRow } from "./ideaListSort";

export const IDEA_FILTER_FIELDS = ["title", "tags", "createdAt", "updatedAt", "assignee"] as const;
export type IdeaFilterField = (typeof IDEA_FILTER_FIELDS)[number];

export const IDEA_FILTER_OPERATORS = [
  "is",
  "is_not",
  "contains",
  "does_not_contain",
  "starts_with",
  "before",
  "after",
  "is_empty",
  "is_not_empty",
] as const;
export type IdeaFilterOperator = (typeof IDEA_FILTER_OPERATORS)[number];

export const IDEA_FILTER_JOINS = ["and", "or"] as const;
export type IdeaFilterJoin = (typeof IDEA_FILTER_JOINS)[number];

export type IdeaFilterClause = {
  field: IdeaFilterField;
  operator: IdeaFilterOperator;
  value: string;
};

export type IdeaListFilter = {
  clauses: IdeaFilterClause[];
  joins: IdeaFilterJoin[];
};

export const IDEA_FILTER_FIELD_LABELS: Record<IdeaFilterField, string> = {
  title: "Title",
  tags: "Tags",
  createdAt: "Created",
  updatedAt: "Updated",
  assignee: "Assignee",
};

export const IDEA_FILTER_OPERATOR_LABELS: Record<IdeaFilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  does_not_contain: "does not contain",
  starts_with: "starts with",
  before: "before",
  after: "after",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

export const IDEA_FILTER_JOIN_LABELS: Record<IdeaFilterJoin, string> = {
  and: "AND",
  or: "OR",
};

export const IDEAS_LIST_FILTER_STORAGE_KEY = "taskmesh.ideasListFilter";

export type IdeaFilterTagOption = Pick<Tag, "id" | "name">;

export type IdeaFilterAssigneeOption = { id: number; displayName: string };

function foldCase(s: string): string {
  return s.toLocaleLowerCase();
}

export function emptyIdeaListFilter(): IdeaListFilter {
  return { clauses: [], joins: [] };
}

export function newIdeaFilterClause(): IdeaFilterClause {
  return { field: "title", operator: "contains", value: "" };
}

export function isIdeaFilterActive(filter: IdeaListFilter | null | undefined): boolean {
  return (filter?.clauses.length ?? 0) > 0;
}

export function operatorsForIdeaField(field: IdeaFilterField): readonly IdeaFilterOperator[] {
  if (field === "title") return ["contains", "does_not_contain", "starts_with", "is", "is_not"];
  if (field === "tags") return ["contains", "does_not_contain", "starts_with"];
  if (field === "createdAt" || field === "updatedAt") return ["is", "is_not", "before", "after"];
  return ["is", "is_not", "is_empty", "is_not_empty"];
}

export function defaultOperatorForIdeaField(field: IdeaFilterField): IdeaFilterOperator {
  if (field === "title" || field === "tags") return "contains";
  return "is";
}

export function defaultValueForIdeaField(field: IdeaFilterField): string {
  if (field === "createdAt" || field === "updatedAt") {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }
  return "";
}

export function clauseValueUsesIdeaPicker(field: IdeaFilterField, operator: IdeaFilterOperator): boolean {
  if (operator === "is_empty" || operator === "is_not_empty") return false;
  if (field === "createdAt" || field === "updatedAt") return true;
  if (field === "tags") return operator === "contains" || operator === "does_not_contain";
  if (field === "assignee") return operator === "is" || operator === "is_not";
  return false;
}

export function applyIdeaClausePatch(
  clause: IdeaFilterClause,
  patch: Partial<IdeaFilterClause>,
): IdeaFilterClause {
  const next: IdeaFilterClause = { ...clause, ...patch };
  if (patch.field && patch.field !== clause.field) {
    const allowed = operatorsForIdeaField(next.field);
    if (!allowed.includes(next.operator)) {
      next.operator = defaultOperatorForIdeaField(next.field);
    }
    next.value = defaultValueForIdeaField(next.field);
  } else if (patch.operator && patch.operator !== clause.operator) {
    const before = clauseValueUsesIdeaPicker(clause.field, clause.operator);
    const after = clauseValueUsesIdeaPicker(next.field, next.operator);
    if (before !== after) next.value = defaultValueForIdeaField(next.field);
  }
  return next;
}

function matchText(haystack: string, needle: string, operator: IdeaFilterOperator): boolean {
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

function localDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function ideaDateKey(idea: IdeaListRow, field: "createdAt" | "updatedAt"): string {
  if (field === "updatedAt") return formatListDate(idea.updatedAt) === "—" ? "" : formatListDate(idea.updatedAt);
  return localDateKey(idea.createdAt);
}

function matchDate(actual: string, clause: IdeaFilterClause): boolean {
  const value = clause.value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !actual) {
    return clause.operator === "is_not";
  }
  if (clause.operator === "is") return actual === value;
  if (clause.operator === "is_not") return actual !== value;
  if (clause.operator === "before") return actual < value;
  if (clause.operator === "after") return actual > value;
  return false;
}

function matchTags(idea: IdeaListRow, clause: IdeaFilterClause): boolean {
  const value = clause.value.trim();
  if (clause.operator === "starts_with") {
    if (!value) return false;
    return idea.tags.some((t) => matchText(t.name, value, "starts_with"));
  }
  const untagged = value === "" || foldCase(value) === "none";
  const has = untagged ? idea.tags.length === 0 : idea.tags.some((t) => String(t.id) === value);
  if (clause.operator === "contains") return has;
  if (clause.operator === "does_not_contain") return !has;
  return false;
}

function matchAssignee(idea: IdeaListRow, clause: IdeaFilterClause): boolean {
  const empty = idea.assigneeId == null;
  if (clause.operator === "is_empty") return empty;
  if (clause.operator === "is_not_empty") return !empty;
  const want = Number(clause.value);
  const eq = Number.isFinite(want) && idea.assigneeId === want;
  if (clause.operator === "is") return eq;
  if (clause.operator === "is_not") return !eq;
  return false;
}

export function ideaMatchesFilter(idea: IdeaListRow, filter: IdeaListFilter): boolean {
  const { clauses, joins } = filter;
  if (clauses.length === 0) return true;
  const clauseMatches = (clause: IdeaFilterClause): boolean => {
    if (clause.field === "title") {
      const value = clause.value.trim();
      if (!value) {
        return clause.operator === "is_not" || clause.operator === "does_not_contain";
      }
      return matchText(idea.title, value, clause.operator);
    }
    if (clause.field === "tags") return matchTags(idea, clause);
    if (clause.field === "createdAt" || clause.field === "updatedAt") {
      return matchDate(ideaDateKey(idea, clause.field), clause);
    }
    if (clause.field === "assignee") return matchAssignee(idea, clause);
    return false;
  };
  let result = clauseMatches(clauses[0]!);
  for (let i = 1; i < clauses.length; i++) {
    const join = joins[i - 1] ?? "and";
    const next = clauseMatches(clauses[i]!);
    result = join === "or" ? result || next : result && next;
  }
  return result;
}

export function evaluateIdeaListFilter(ideas: IdeaListRow[], filter: IdeaListFilter): IdeaListRow[] {
  if (!isIdeaFilterActive(filter)) return ideas;
  return ideas.filter((idea) => ideaMatchesFilter(idea, filter));
}

function clauseValueLabel(
  clause: IdeaFilterClause,
  tags: readonly IdeaFilterTagOption[],
  assignees: readonly IdeaFilterAssigneeOption[],
): string {
  if (clause.operator === "is_empty" || clause.operator === "is_not_empty") return "";
  if (clause.field === "tags") {
    const raw = clause.value.trim();
    if (!raw || foldCase(raw) === "none") return "None";
    const id = Number(raw);
    return tags.find((t) => t.id === id)?.name ?? raw;
  }
  if (clause.field === "assignee") {
    const id = Number(clause.value);
    return assignees.find((a) => a.id === id)?.displayName ?? (clause.value.trim() || "∅");
  }
  return clause.value.trim() || "∅";
}

export function formatIdeaFilterBreadcrumb(
  filter: IdeaListFilter,
  tags: readonly IdeaFilterTagOption[],
  assignees: readonly IdeaFilterAssigneeOption[],
): string {
  if (!isIdeaFilterActive(filter)) return "";
  const parts: string[] = [];
  filter.clauses.forEach((clause, i) => {
    if (i > 0) parts.push(IDEA_FILTER_JOIN_LABELS[filter.joins[i - 1] ?? "and"]);
    const value = clauseValueLabel(clause, tags, assignees);
    const op = IDEA_FILTER_OPERATOR_LABELS[clause.operator];
    parts.push(value ? `${IDEA_FILTER_FIELD_LABELS[clause.field]} ${op} ${value}` : `${IDEA_FILTER_FIELD_LABELS[clause.field]} ${op}`);
  });
  return parts.join(" ");
}

function isIdeaFilterField(v: string): v is IdeaFilterField {
  return (IDEA_FILTER_FIELDS as readonly string[]).includes(v);
}

function isIdeaFilterOperator(v: string): v is IdeaFilterOperator {
  return (IDEA_FILTER_OPERATORS as readonly string[]).includes(v);
}

function isIdeaFilterJoin(v: string): v is IdeaFilterJoin {
  return (IDEA_FILTER_JOINS as readonly string[]).includes(v);
}

export function parseStoredIdeaListFilter(raw: string | null): IdeaListFilter | null {
  if (raw == null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.clauses) || !Array.isArray(obj.joins)) return null;
  const clauses: IdeaFilterClause[] = [];
  for (const c of obj.clauses) {
    if (!c || typeof c !== "object") return null;
    const row = c as Record<string, unknown>;
    if (typeof row.field !== "string" || !isIdeaFilterField(row.field)) return null;
    if (typeof row.operator !== "string" || !isIdeaFilterOperator(row.operator)) return null;
    if (typeof row.value !== "string") return null;
    if (!operatorsForIdeaField(row.field).includes(row.operator)) return null;
    clauses.push({ field: row.field, operator: row.operator, value: row.value });
  }
  const joins: IdeaFilterJoin[] = [];
  for (const j of obj.joins) {
    if (typeof j !== "string" || !isIdeaFilterJoin(j)) return null;
    joins.push(j);
  }
  return { clauses, joins: joins.slice(0, Math.max(0, clauses.length - 1)) };
}

export function loadIdeaListFilter(storageKey: string): IdeaListFilter {
  try {
    return parseStoredIdeaListFilter(localStorage.getItem(storageKey)) ?? emptyIdeaListFilter();
  } catch {
    return emptyIdeaListFilter();
  }
}

export function saveIdeaListFilter(storageKey: string, filter: IdeaListFilter): void {
  try {
    if (!isIdeaFilterActive(filter)) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(filter));
  } catch {
    /* ignore quota / private mode */
  }
}
