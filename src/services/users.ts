import { eq, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { AuthenticationError } from "../lib/authErrors.js";
import { getRequestApiKeyUserId, getRequestSessionUserId } from "../lib/requestAuthContext.js";
import { hashPassword, validatePassword } from "../lib/password.js";
import { toUserRef, type UserRef } from "../lib/userFields.js";

type Db = NodePgDatabase<typeof schema>;

/** Next app-wide unique user number (max existing + 1, or 1). */
export async function allocateUserNumber(db: Db): Promise<number> {
  const [row] = await db.select({ m: max(schema.users.number) }).from(schema.users);
  return (row?.m ?? 0) + 1;
}

/**
 * Resolve the authenticated user from the current request session or API key (T0063).
 * Throws {@link AuthenticationError} when no valid auth context is present.
 */
export async function getAuthenticatedUser(
  db: Db,
): Promise<typeof schema.users.$inferSelect> {
  const actorUserId = getRequestApiKeyUserId() ?? getRequestSessionUserId();
  if (actorUserId == null) {
    throw new AuthenticationError();
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, actorUserId))
    .limit(1);
  if (!user) {
    throw new AuthenticationError();
  }
  return user;
}

/** Current authenticated user for mutating routes and profile APIs. */
export async function getCurrentUser(db: Db): Promise<typeof schema.users.$inferSelect> {
  return getAuthenticatedUser(db);
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
