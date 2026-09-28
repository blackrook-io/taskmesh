import { and, eq } from "drizzle-orm";
import type { db as Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import {
  resolveTodoCheckToggle,
  type TodoProgressResult,
  type TodoProgressSnapshot,
} from "../lib/todoProgress.js";

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
): Promise<void> {
  await database
    .update(schema.todos)
    .set({
      progress: result.progress,
      state: result.state,
      updatedById: actorId,
      updatedAt: new Date(),
    })
    .where(eq(schema.todos.id, todoId));
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
