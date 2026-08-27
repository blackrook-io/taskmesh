import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { verifyPassword } from "../lib/password.js";
import { userCanAuthenticate } from "../lib/userAuth.js";
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
  return { id, expiresAt, maxAgeSeconds };
}

export async function destroySession(db: Db, sessionId: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
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
    updatedAt: Date;
  } = {
    failedLoginCount: nextCount,
    updatedAt: new Date(),
  };
  if (shouldLockAfterFailedLogin(user.failedLoginCount, threshold)) {
    patch.lockedAt = new Date();
  }
  await db.update(schema.users).set(patch).where(eq(schema.users.id, userId));
}

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
    if (user) {
      await recordFailedLogin(db, user.id);
    }
    throw authServiceError(401, "invalid_credentials");
  };

  if (!user || !user.passwordHash) {
    return reject();
  }
  if (!userCanAuthenticate(user)) {
    return reject();
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return reject();
  }

  const now = new Date();
  const [updated] = await db
    .update(schema.users)
    .set({
      failedLoginCount: 0,
      lastLoginAt: now,
      updatedAt: now,
    })
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
