import type { TodoListItem } from "../types";
import { TASK_PRIORITIES, TASK_STATES } from "./taskFields";

const TYPE_LABEL: Record<TodoListItem["entityType"], string> = {
  idea: "Idea",
  task: "Task",
  todo: "ToDo",
};

function rank(order: readonly string[], value: string | null | undefined): number {
  const idx = order.indexOf(value ?? "");
  return idx < 0 ? order.length : idx;
}

/** Column compare for ToDo list rows. `0` means tie (caller keeps manual order). */
export function compareTodoListItems(a: TodoListItem, b: TodoListItem, col: string): number {
  switch (col) {
    case "type":
      return TYPE_LABEL[a.entityType].localeCompare(TYPE_LABEL[b.entityType]);
    case "title":
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    case "state":
      return rank(TASK_STATES, a.state) - rank(TASK_STATES, b.state);
    case "priority":
      return rank(TASK_PRIORITIES, a.priority ?? "none") - rank(TASK_PRIORITIES, b.priority ?? "none");
    case "dueDate": {
      const da = a.dueDate ?? "";
      const db = b.dueDate ?? "";
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    }
    case "checked":
      return Number(a.checked) - Number(b.checked);
    default:
      return 0;
  }
}

export function sortTodoListItems(items: TodoListItem[], col: string | null, dir: 1 | -1): TodoListItem[] {
  if (col == null) return items;
  return [...items].sort((a, b) => {
    const primary = compareTodoListItems(a, b, col);
    if (primary !== 0) return primary * dir;
    return a.sortOrder - b.sortOrder || a.id - b.id;
  });
}
