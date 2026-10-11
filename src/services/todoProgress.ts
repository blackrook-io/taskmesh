import { and, eq } from "drizzle-orm";
import type { db as Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import type { ActivitySource } from "../lib/activityRequest.js";
import {
  resolveTodoCheckToggle,
  type TodoProgressResult,
  type TodoProgressSnapshot,
} from "../lib/todoProgress.js";
import { recordTodoFieldChanges } from "./entityActivity.js";

type Database = typeof Db;

export async function syncTodoMembershipChecked(
  database: Database,
  todoId: number,
  checked: boolean,
): Promise<void> {
  await database
    .update(schema.todoListItems)
    .set({ checked, updatedAt: new Date() })
    .where(
      and(eq(schema.todoListItems.entityType, "todo"), eq(schema.todoListItems.entityId, todoId)),
    );
}

export async function applyTodoProgressResult(
  database: Database,
  todoId: number,
  actorId: number,
  result: TodoProgressResult,
  source: ActivitySource = "api",
): Promise<void> {
  const [before] = await database
    .select({ state: schema.todos.state, progress: schema.todos.progress })
    .from(schema.todos)
    .where(eq(schema.todos.id, todoId));
  await database
    .update(schema.todos)
    .set({
      progress: result.progress,
      state: result.state,
      updatedById: actorId,
      updatedAt: new Date(),
    })
    .where(eq(schema.todos.id, todoId));
  if (before) {
    await recordTodoFieldChanges(database, todoId, before, result, actorId, source);
  }
  if (result.membershipChecked != null) {
    await syncTodoMembershipChecked(database, todoId, result.membershipChecked);
  }
}

export function progressFieldsForCheck(
  checked: boolean,
  current: TodoProgressSnapshot,
): TodoProgressResult | null {
  return resolveTodoCheckToggle(checked, current);
}
