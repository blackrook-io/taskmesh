import { asc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { toUserRef, type UserRef } from "../lib/userFields.js";
import { hashPassword, validatePassword } from "../lib/password.js";

type Db = NodePgDatabase<typeof schema>;

export type AdminUserRow = UserRef & {
  email: string | null;
  deactivatedAt: string | null;
  lockedAt: string | null;
  lastLoginAt: string | null;
  lastApiAt: string | null;
  hasPassword: boolean;
  failedLoginCount: number;
};

function toAdminUser(row: typeof schema.users.$inferSelect): AdminUserRow {
  return {
    ...toUserRef(row),
    email: row.email,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    lockedAt: row.lockedAt?.toISOString() ?? null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    lastApiAt: row.lastApiAt?.toISOString() ?? null,
    hasPassword: Boolean(row.passwordHash),
    failedLoginCount: row.failedLoginCount,
  };
}

export async function listAdminUsers(db: Db): Promise<AdminUserRow[]> {
  const rows = await db
    .select()
    .from(schema.users)
    .orderBy(asc(schema.users.number));
  return rows.map(toAdminUser);
}

export async function resetUserPassword(
  db: Db,
  userId: number,
  password: string,
): Promise<AdminUserRow> {
  const err = validatePassword(password);
  if (err) {
    throw Object.assign(new Error(err), { status: 400, code: "invalid_password" });
  }
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!existing) {
    throw Object.assign(new Error("User not found"), { status: 404, code: "not_found" });
  }
  const passwordHash = await hashPassword(password);
  const [row] = await db
    .update(schema.users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(schema.users.id, userId))
    .returning();
  return toAdminUser(row!);
}

export async function deactivateUser(db: Db, userId: number): Promise<AdminUserRow> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!existing) {
    throw Object.assign(new Error("User not found"), { status: 404, code: "not_found" });
  }
  const [row] = await db
    .update(schema.users)
    .set({ deactivatedAt: now, updatedAt: now })
    .where(eq(schema.users.id, userId))
    .returning();

  // Immediately revoke all of the user's API keys.
  await db
    .update(schema.apiKeys)
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where(eq(schema.apiKeys.userId, userId));

  return toAdminUser(row!);
}

export async function reactivateUser(db: Db, userId: number): Promise<AdminUserRow> {
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!existing) {
    throw Object.assign(new Error("User not found"), { status: 404, code: "not_found" });
  }
  const [row] = await db
    .update(schema.users)
    .set({
      deactivatedAt: null,
      failedLoginCount: 0,
      lockedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId))
    .returning();
  return toAdminUser(row!);
}

/** Used by deactivate cascade helpers if needed. */
export async function revokeKeysForUsers(db: Db, userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  const now = new Date();
  await db
    .update(schema.apiKeys)
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where(inArray(schema.apiKeys.userId, userIds));
}
