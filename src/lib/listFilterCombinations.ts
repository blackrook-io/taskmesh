/**
 * Valid List View filter field → operator pairs.
 * The filter dropdowns and the API both read this module.
 */

export const TASK_LIST_FILTER_COMBINATIONS = {
  state: ["is", "is_not", "contains", "does_not_contain", "starts_with"],
  priority: ["is", "is_not", "contains", "does_not_contain", "starts_with"],
  title: ["is", "is_not", "contains", "does_not_contain", "starts_with"],
  number: ["is", "is_not", "contains", "does_not_contain", "starts_with"],
  phase: ["is", "is_not", "contains", "does_not_contain", "starts_with"],
  tags: ["contains", "does_not_contain", "starts_with"],
  project: ["is", "is_not", "contains", "does_not_contain", "starts_with"],
  dueDate: ["before", "after"],
  startDate: ["before", "after"],
  estimateHours: ["is", "gt", "lt", "is_empty", "is_not_empty"],
} as const;

export const IDEA_LIST_FILTER_COMBINATIONS = {
  title: ["contains", "does_not_contain", "starts_with", "is", "is_not"],
  tags: ["contains", "does_not_contain", "starts_with"],
  createdAt: ["is", "is_not", "before", "after"],
  updatedAt: ["is", "is_not", "before", "after"],
  assignee: ["is", "is_not", "is_empty", "is_not_empty"],
} as const;

export const TODO_LIST_FILTER_COMBINATIONS = {
  state: ["is", "is_not"],
  priority: ["is", "is_not"],
  dueDate: ["is", "is_not", "before", "after"],
  startDate: ["is", "is_not", "before", "after"],
  estimateHours: ["is", "gt", "lt", "is_empty", "is_not_empty"],
  tags: ["contains", "does_not_contain", "starts_with"],
  title: ["contains", "does_not_contain", "starts_with", "is", "is_not"],
  checked: ["is", "is_not"],
  entityType: ["is", "is_not"],
} as const;

export function isAllowedFilterCombination(
  combinations: object,
  field: string,
  operator: string,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(combinations, field)) return false;
  const allowed = (combinations as Record<string, readonly string[]>)[field];
  return allowed != null && allowed.includes(operator);
}
