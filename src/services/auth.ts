import { randomBytes } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { hashPassword, needsPasswordRehash, verifyPassword } from "../lib/password.js";
import { getSystemProperties } from "./systemProperties.js";

type Db = NodePgDatabase<typeof schema>;

export const LOGIN_ERROR_MESSAGE = "Invalid email or password.";

export type AuthServiceError = {
  status: number;
  code: string;
  message: string;
};

export function authServiceError(
  status: number,
  code: string,
  message: string = LOGIN_ERROR_MESSAGE,
): AuthServiceError {
  return { status, code, message };
}

export function shouldLockAfterFailedLogin(
  failedLoginCount: number,
  threshold: number,
): boolean {
  return failedLoginCount + 1 >= threshold;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export async function getSessionById(
  db: Db,
  sessionId: string,
): Promise<typeof schema.sessions.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await destroySession(db, sessionId);
    return null;
  }
  return row;
}

export async function createSession(
  db: Db,
  userId: number,
): Promise<{ id: string; expiresAt: Date; maxAgeSeconds: number }> {
  const props = await getSystemProperties(db);
  const maxAgeSeconds = props.sessionTimeoutMinutes * 60;
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
  const id = newSessionId();
  await db.insert(schema.sessions).values({ id, userId, expiresAt });
  // Single concurrent browser session: drop every other session for this user.
  await destroyOtherSessionsForUser(db, userId, id);
  return { id, expiresAt, maxAgeSeconds };
}

export async function destroySession(db: Db, sessionId: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
}

export async function destroyAllSessionsForUser(db: Db, userId: number): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

export async function destroyOtherSessionsForUser(
  db: Db,
  userId: number,
  keepSessionId: string,
): Promise<void> {
  await db
    .delete(schema.sessions)
    .where(
      and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, keepSessionId)),
    );
}

async function recordFailedLogin(db: Db, userId: number): Promise<void> {
  const threshold = (await getSystemProperties(db)).loginFailureThreshold;
  const [user] = await db
    .select({
      failedLoginCount: schema.users.failedLoginCount,
      lockedAt: schema.users.lockedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user || user.lockedAt != null) return;

  const nextCount = user.failedLoginCount + 1;
  const patch: {
    failedLoginCount: number;
    lockedAt?: Date;
    lockReason?: string;
    updatedAt: Date;
  } = {
    failedLoginCount: nextCount,
    updatedAt: new Date(),
  };
  if (shouldLockAfterFailedLogin(user.failedLoginCount, threshold)) {
    patch.lockedAt = new Date();
    patch.lockReason = "login_failures";
  }
  await db.update(schema.users).set(patch).where(eq(schema.users.id, userId));
}

/**
 * Verify email/password. Does not create a session (MFA/grace may follow).
 * Locked/deactivated accounts: password is still checked so MFA-deadline
 * messaging can surface after a correct password.
 */
export async function loginWithEmailPassword(
  db: Db,
  email: string,
  password: string,
): Promise<typeof schema.users.$inferSelect> {
  const normalized = normalizeEmail(email);
  const [user] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${normalized}`)
    .limit(1);

  const reject = async (): Promise<never> => {
    if (user && user.lockedAt == null && user.deactivatedAt == null) {
      await recordFailedLogin(db, user.id);
    }
    throw authServiceError(401, "invalid_credentials");
  };

  if (!user || !user.passwordHash) {
    return reject();
  }
  if (user.deactivatedAt != null) {
    return reject();
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return reject();
  }

  // Correct password but locked — surface MFA deadline distinctly.
  if (user.lockedAt != null) {
    if (user.lockReason === "mfa_deadline") {
      throw authServiceError(
        403,
        "mfa_locked",
        "Your account is locked because multi-factor authentication was not set up in time. Contact an administrator to unlock your account.",
      );
    }
    throw authServiceError(
      403,
      "account_locked",
      "Your account is locked. Contact an administrator.",
    );
  }

  const now = new Date();
  const patch: {
    failedLoginCount: number;
    lastLoginAt: Date;
    updatedAt: Date;
    passwordHash?: string;
  } = {
    failedLoginCount: 0,
    lastLoginAt: now,
    updatedAt: now,
  };
  if (needsPasswordRehash(user.passwordHash)) {
    patch.passwordHash = await hashPassword(password);
  }
  const [updated] = await db
    .update(schema.users)
    .set(patch)
    .where(eq(schema.users.id, user.id))
    .returning();
  if (!updated) {
    throw authServiceError(500, "login_failed", "Could not complete login");
  }
  return updated;
}

export async function getUserById(
  db: Db,
  userId: number,
): Promise<typeof schema.users.$inferSelect | null> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return user ?? null;
}
