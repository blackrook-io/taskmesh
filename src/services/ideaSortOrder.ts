import { min } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

/** Next Ideas-list index so a new idea appears first in manual order (min − 1, or 0). */
export async function nextIdeaSortOrder(db: Db): Promise<number> {
  const [row] = await db.select({ m: min(schema.ideas.sortOrder) }).from(schema.ideas);
  return row?.m == null ? 0 : row.m - 1;
}
