import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

/** Next append index for projects.sort_order (max + 1, or 0 when empty). */
export async function nextProjectSortOrder(db: Db): Promise<number> {
  const rows = await db.select({ m: schema.projects.sortOrder }).from(schema.projects);
  return rows.length ? Math.max(...rows.map((r) => r.m)) + 1 : 0;
}
