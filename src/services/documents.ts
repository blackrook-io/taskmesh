import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type { UserRef } from "../lib/userFields.js";
import { loadUserMap } from "./users.js";

type Db = NodePgDatabase<typeof schema>;

export type ProjectDocumentWithActors = typeof schema.projectDocuments.$inferSelect & {
  updatedBy: UserRef | null;
};

export async function attachDocumentActors(
  db: Db,
  rows: (typeof schema.projectDocuments.$inferSelect)[],
): Promise<ProjectDocumentWithActors[]> {
  if (rows.length === 0) return [];
  const byId = await loadUserMap(db);
  return rows.map((row) => ({
    ...row,
    updatedBy: row.updatedById != null ? (byId.get(row.updatedById) ?? null) : null,
  }));
}

export async function attachDocumentActor(
  db: Db,
  row: typeof schema.projectDocuments.$inferSelect,
): Promise<ProjectDocumentWithActors> {
  const [withActors] = await attachDocumentActors(db, [row]);
  if (!withActors) {
    return { ...row, updatedBy: null };
  }
  return withActors;
}
