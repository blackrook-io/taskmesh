import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { isFinishedChildState } from "../lib/taskFields.js";
import {
  isDependencyBlockingState,
  listDependsOn,
  type TaskDepSummary,
} from "./taskDependencies.js";

type Db = NodePgDatabase<typeof schema>;

export type WaitingOnKind = "blocked" | "pending";

export type WaitingOnResult = {
  kind: WaitingOnKind | null;
  tasks: TaskDepSummary[];
};

/** Blocked waits on open Depends-on. Pending waits on unfinished direct children. */
export function selectWaitingOnTasks(
  state: string,
  dependsOn: TaskDepSummary[],
  children: TaskDepSummary[],
): WaitingOnResult {
  if (state === "blocked") {
    return {
      kind: "blocked",
      tasks: dependsOn.filter((task) => isDependencyBlockingState(task.state)),
    };
  }
  if (state === "pending") {
    return {
      kind: "pending",
      tasks: children.filter((task) => !isFinishedChildState(task.state)),
    };
  }
  return { kind: null, tasks: [] };
}

export async function listWaitingOn(db: Db, taskId: number, state: string): Promise<WaitingOnResult> {
  if (state !== "blocked" && state !== "pending") {
    return { kind: null, tasks: [] };
  }
  if (state === "blocked") {
    const dependsOn = await listDependsOn(db, taskId);
    return selectWaitingOnTasks(state, dependsOn, []);
  }
  const children = await db
    .select({
      id: schema.tasks.id,
      number: schema.tasks.number,
      title: schema.tasks.title,
      state: schema.tasks.state,
    })
    .from(schema.tasks)
    .where(eq(schema.tasks.parentId, taskId))
    .orderBy(asc(schema.tasks.number));
  return selectWaitingOnTasks(state, [], children);
}
