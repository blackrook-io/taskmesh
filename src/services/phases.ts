import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

/** First phase for a project by sort order, or null when the project has none. */
export async function firstPhaseId(db: Db, projectId: number): Promise<number | null> {
  const existing = await db
    .select({ id: schema.projectPhases.id })
    .from(schema.projectPhases)
    .where(eq(schema.projectPhases.projectId, projectId))
    .orderBy(asc(schema.projectPhases.sortOrder))
    .limit(1);

  return existing[0]?.id ?? null;
}
