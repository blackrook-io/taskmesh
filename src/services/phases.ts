import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

export async function ensureDefaultPhase(db: Db, projectId: number): Promise<number> {
  const existing = await db
    .select({ id: schema.projectPhases.id })
    .from(schema.projectPhases)
    .where(eq(schema.projectPhases.projectId, projectId))
    .orderBy(asc(schema.projectPhases.sortOrder))
    .limit(1);

  if (existing[0]) {
    return existing[0].id;
  }

  const [row] = await db
    .insert(schema.projectPhases)
    .values({
      projectId,
      name: "Main",
      sortOrder: 0,
    })
    .returning({ id: schema.projectPhases.id });

  if (!row) {
    throw new Error("Failed to create default phase");
  }
  return row.id;
}
