import { asc, eq, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { hashPassword, validatePassword } from "../lib/password.js";
import { toUserRef, type UserRef } from "../lib/userFields.js";

type Db = NodePgDatabase<typeof schema>;

/** Next app-wide unique user number (max existing + 1, or 1). */
export async function allocateUserNumber(db: Db): Promise<number> {
  const [row] = await db.select({ m: max(schema.users.number) }).from(schema.users);
  return (row?.m ?? 0) + 1;
}

/**
 * Current user until auth exists: prefer number=1, else lowest id.
 * Ensures a default row exists (U0001 / Local User) if the table is empty.
 */
export async function getCurrentUser(db: Db): Promise<typeof schema.users.$inferSelect> {
  const [byNumber] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.number, 1));
  if (byNumber) return byNumber;

  const [first] = await db
    .select()
    .from(schema.users)
    .orderBy(asc(schema.users.id))
    .limit(1);
  if (first) return first;

  const [created] = await db
    .insert(schema.users)
    .values({ number: 1, displayName: "Local User" })
    .returning();
  if (!created) {
    throw new Error("Could not create default user");
  }
  return created;
}

export async function getCurrentUserId(db: Db): Promise<number> {
  const user = await getCurrentUser(db);
  return user.id;
}

export async function getCurrentUserRef(db: Db): Promise<UserRef> {
  return toUserRef(await getCurrentUser(db));
}

/**
 * Set or replace the current user's password hash.
 * Plaintext is never stored or returned — only a scrypt hash is written.
 */
export async function setCurrentUserPassword(
  db: Db,
  password: string,
): Promise<typeof schema.users.$inferSelect> {
  const err = validatePassword(password);
  if (err) {
    throw Object.assign(new Error(err), { status: 400, code: "invalid_password" });
  }
  const current = await getCurrentUser(db);
  const passwordHash = await hashPassword(password);
  const [row] = await db
    .update(schema.users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(schema.users.id, current.id))
    .returning();
  if (!row) {
    throw Object.assign(new Error("Could not update password"), {
      status: 500,
      code: "update_failed",
    });
  }
  return row;
}

export async function loadUserMap(
  db: Db,
): Promise<Map<number, UserRef>> {
  const rows = await db.select().from(schema.users);
  return new Map(rows.map((u) => [u.id, toUserRef(u)]));
}

export type TaskWithActors = typeof schema.tasks.$inferSelect & {
  createdBy: UserRef | null;
  updatedBy: UserRef | null;
};

export async function attachTaskActors(
  db: Db,
  rows: (typeof schema.tasks.$inferSelect)[],
): Promise<TaskWithActors[]> {
  if (rows.length === 0) return [];
  const byId = await loadUserMap(db);
  return rows.map((row) => ({
    ...row,
    createdBy: byId.get(row.createdById) ?? null,
    updatedBy: byId.get(row.updatedById) ?? null,
  }));
}

export async function attachTaskActor(
  db: Db,
  row: typeof schema.tasks.$inferSelect,
): Promise<TaskWithActors> {
  const [withActors] = await attachTaskActors(db, [row]);
  if (!withActors) {
    return { ...row, createdBy: null, updatedBy: null };
  }
  return withActors;
}
