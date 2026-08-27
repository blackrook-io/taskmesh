import { asc, count, eq, inArray, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type { RoleRef } from "../lib/roles.js";
import { toUserRef, type UserRef } from "../lib/userFields.js";
import { hashPassword, validatePassword } from "../lib/password.js";
import { deleteUserDeniedReason } from "../lib/userAuth.js";
import { allocateUserNumber } from "./users.js";
import { guardLastAdministrator, listRolesByUserIds } from "./roles.js";

type Db = NodePgDatabase<typeof schema>;

export type AdminUserRow = UserRef & {
  email: string | null;
  deactivatedAt: string | null;
  lockedAt: string | null;
  lastLoginAt: string | null;
  lastApiAt: string | null;
  hasPassword: boolean;
  failedLoginCount: number;
  roles: RoleRef[];
};

function toAdminUser(
  row: typeof schema.users.$inferSelect,
  roles: RoleRef[] = [],
): AdminUserRow {
  return {
    ...toUserRef(row),
    email: row.email,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    lockedAt: row.lockedAt?.toISOString() ?? null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    lastApiAt: row.lastApiAt?.toISOString() ?? null,
    hasPassword: Boolean(row.passwordHash),
    failedLoginCount: row.failedLoginCount,
    roles,
  };
}

export async function listAdminUsers(db: Db): Promise<AdminUserRow[]> {
  const rows = await db
    .select()
    .from(schema.users)
    .orderBy(asc(schema.users.number));
  const rolesByUser = await listRolesByUserIds(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((row) => toAdminUser(row, rolesByUser.get(row.id) ?? []));
}

function serviceErr(message: string, status: number, code: string): Error {
  return Object.assign(new Error(message), { status, code });
}

async function requireUser(db: Db, userId: number): Promise<typeof schema.users.$inferSelect> {
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!existing) {
    throw serviceErr("User not found", 404, "not_found");
  }
  return existing;
}

async function userHasRestrictedAuthorship(db: Db, userId: number): Promise<boolean> {
  const [taskRow] = await db
    .select({ value: count() })
    .from(schema.tasks)
    .where(
      or(eq(schema.tasks.createdById, userId), eq(schema.tasks.updatedById, userId)),
    );
  if ((taskRow?.value ?? 0) > 0) return true;
  const [todoRow] = await db
    .select({ value: count() })
    .from(schema.todos)
    .where(
      or(eq(schema.todos.createdById, userId), eq(schema.todos.updatedById, userId)),
    );
  return (todoRow?.value ?? 0) > 0;
}

export async function createAdminUser(
  db: Db,
  input: { displayName: string; email: string; password: string },
): Promise<AdminUserRow> {
  const err = validatePassword(input.password);
  if (err) {
    throw serviceErr(err, 400, "invalid_password");
  }
  const [dup] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, input.email))
    .limit(1);
  if (dup) {
    throw serviceErr("Email is already in use", 409, "email_taken");
  }
  const number = await allocateUserNumber(db);
  const passwordHash = await hashPassword(input.password);
  const [row] = await db
    .insert(schema.users)
    .values({
      number,
      displayName: input.displayName,
      email: input.email,
      passwordHash,
    })
    .returning();
  if (!row) {
    throw serviceErr("Could not create user", 500, "create_failed");
  }
  return toAdminUser(row);
}

export async function lockUser(db: Db, userId: number): Promise<AdminUserRow> {
  const existing = await requireUser(db, userId);
  if (existing.deactivatedAt) {
    throw serviceErr("Cannot lock a deactivated user", 409, "user_deactivated");
  }
  await guardLastAdministrator(db, userId, "lock");
  const now = new Date();
  const [row] = await db
    .update(schema.users)
    .set({ lockedAt: now, updatedAt: now })
    .where(eq(schema.users.id, userId))
    .returning();
  return toAdminUser(row!);
}

export async function unlockUser(db: Db, userId: number): Promise<AdminUserRow> {
  const existing = await requireUser(db, userId);
  if (existing.deactivatedAt) {
    throw serviceErr("Cannot unlock a deactivated user", 409, "user_deactivated");
  }
  const [row] = await db
    .update(schema.users)
    .set({
      lockedAt: null,
      failedLoginCount: 0,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId))
    .returning();
  return toAdminUser(row!);
}

export async function deleteAdminUser(
  db: Db,
  userId: number,
  currentUserId: number,
): Promise<void> {
  await requireUser(db, userId);
  await guardLastAdministrator(db, userId, "delete");
  const [countRow] = await db.select({ value: count() }).from(schema.users);
  const denied = deleteUserDeniedReason({
    userCount: countRow?.value ?? 0,
    targetId: userId,
    currentUserId,
    hasRestrictedAuthorship: await userHasRestrictedAuthorship(db, userId),
  });
  if (denied) {
    throw serviceErr(denied.message, denied.status, denied.code);
  }
  try {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23503"
    ) {
      throw serviceErr(
        "This user has authored tasks or ToDos. Deactivate them instead.",
        409,
        "user_has_records",
      );
    }
    throw err;
  }
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
  await guardLastAdministrator(db, userId, "deactivate");
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
