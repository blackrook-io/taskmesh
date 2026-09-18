/** Project Overview panel registry + client-side list queries (T0135). */

import type { Task, Todo } from "../types";

export const OVERVIEW_PANEL_KEYS = [
  "recently_completed_tasks",
  "next_tasks_due",
  "todos_overdue",
  "todos_upcoming",
] as const;

export type OverviewPanelKey = (typeof OVERVIEW_PANEL_KEYS)[number];

export const OVERVIEW_PANEL_LIMITS = [5, 10, 20] as const;
export type OverviewPanelLimit = (typeof OVERVIEW_PANEL_LIMITS)[number];

export type OverviewPanelPref = {
  limit: OverviewPanelLimit;
  days?: number;
};

export type OverviewPanelsPrefs = Record<OverviewPanelKey, OverviewPanelPref>;

export const OVERVIEW_PANELS_WITH_DAYS: ReadonlySet<OverviewPanelKey> = new Set([
  "recently_completed_tasks",
  "todos_upcoming",
]);

export const OVERVIEW_PANEL_META: Record<
  OverviewPanelKey,
  { title: string; entity: "task" | "todo"; usesDays: boolean }
> = {
  recently_completed_tasks: {
    title: "Recently completed tasks",
    entity: "task",
    usesDays: true,
  },
  next_tasks_due: {
    title: "Next tasks due",
    entity: "task",
    usesDays: false,
  },
  todos_overdue: {
    title: "Overdue ToDos",
    entity: "todo",
    usesDays: false,
  },
  todos_upcoming: {
    title: "Upcoming ToDos",
    entity: "todo",
    usesDays: true,
  },
};

/** Fixed layout order — T0136 will replace with stored canvas layout. */
export const OVERVIEW_PANEL_LAYOUT: OverviewPanelKey[] = [...OVERVIEW_PANEL_KEYS];

const ACTIVE_TASK_STATES = new Set([
  "new",
  "ready",
  "in_progress",
  "pending",
  "on_hold",
]);

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar YYYY-MM-DD. */
export function localYmd(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const parts = ymd.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const dt = new Date(y, m - 1, day);
  dt.setDate(dt.getDate() + days);
  return localYmd(dt);
}

function isIncomplete(state: string): boolean {
  return ACTIVE_TASK_STATES.has(state);
}

export function selectRecentlyCompletedTasks(
  tasks: Task[],
  limit: number,
  days: number,
  now = new Date(),
): Task[] {
  const today = localYmd(now);
  const earliest = addDaysYmd(today, -Math.max(1, days));
  return tasks
    .filter((t) => t.state === "complete" && t.updatedAt)
    .filter((t) => {
      const ymd = localYmd(new Date(t.updatedAt));
      return ymd >= earliest && ymd <= today;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export function selectNextTasksDue(tasks: Task[], limit: number): Task[] {
  return tasks
    .filter((t) => isIncomplete(t.state) && t.dueDate)
    .sort((a, b) => {
      const due = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      if (due !== 0) return due;
      return a.sortOrder - b.sortOrder || a.id - b.id;
    })
    .slice(0, limit);
}

export function selectOverdueTodos(todos: Todo[], limit: number, now = new Date()): Todo[] {
  const today = localYmd(now);
  return todos
    .filter((t) => isIncomplete(t.state) && t.dueDate && t.dueDate < today)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.id - b.id)
    .slice(0, limit);
}

export function selectUpcomingTodos(
  todos: Todo[],
  limit: number,
  days: number,
  now = new Date(),
): Todo[] {
  const today = localYmd(now);
  const latest = addDaysYmd(today, Math.max(1, days));
  return todos
    .filter(
      (t) =>
        isIncomplete(t.state) &&
        t.dueDate &&
        t.dueDate >= today &&
        t.dueDate <= latest,
    )
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.id - b.id)
    .slice(0, limit);
}

export function rowsForPanel(
  key: OverviewPanelKey,
  tasks: Task[],
  todos: Todo[],
  pref: OverviewPanelPref,
): Array<{ id: number; number: number; title: string; meta: string | null; color: string | null }> {
  const limit = pref.limit;
  const days = pref.days ?? 14;
  if (key === "recently_completed_tasks") {
    return selectRecentlyCompletedTasks(tasks, limit, days).map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      meta: t.updatedAt ? localYmd(new Date(t.updatedAt)) : null,
      color: t.color,
    }));
  }
  if (key === "next_tasks_due") {
    return selectNextTasksDue(tasks, limit).map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      meta: t.dueDate,
      color: t.color,
    }));
  }
  if (key === "todos_overdue") {
    return selectOverdueTodos(todos, limit).map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      meta: t.dueDate,
      color: t.color,
    }));
  }
  return selectUpcomingTodos(todos, limit, days).map((t) => ({
    id: t.id,
    number: t.number,
    title: t.title,
    meta: t.dueDate,
    color: t.color,
  }));
}
