import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

/** Ensures a global Inbox list exists (project_id null, kind inbox). */
export async function ensureInboxList(db: Db): Promise<number> {
  const existing = await db
    .select({ id: schema.todoLists.id })
    .from(schema.todoLists)
    .where(and(isNull(schema.todoLists.projectId), eq(schema.todoLists.kind, "inbox")))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [row] = await db
    .insert(schema.todoLists)
    .values({
      title: "Inbox",
      projectId: null,
      kind: "inbox",
    })
    .returning({ id: schema.todoLists.id });
  if (!row) throw new Error("Failed to create Inbox list");
  return row.id;
}
