import { randomBytes } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { encryptMfaSecret, decryptMfaSecret, hasMfaTotpKey } from "../lib/mfaCrypto.js";
import { generateTotpSecret, totpUri, verifyTotpCode } from "../lib/totp.js";
import { userIsAdministrator } from "./roles.js";
import { getSystemProperties, type MfaEnforcement } from "./systemProperties.js";

type Db = NodePgDatabase<typeof schema>;

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGE_ATTEMPTS = 5;

export type LockReason = "login_failures" | "mfa_deadline" | "admin";

export const MFA_LOCKED_MESSAGE =
  "Your account is locked because multi-factor authentication was not set up in time. Contact an administrator to unlock your account.";

export const MFA_ENROLL_KEY_MESSAGE =
  "MFA_TOTP_KEY is not configured on the server. Ask an administrator to set it before enrolling MFA.";

function serviceErr(message: string, status: number, code: string): Error {
  return Object.assign(new Error(message), { status, code });
}

function newChallengeId(): string {
  return randomBytes(24).toString("base64url");
}

export function isMfaEnrolled(user: {
  mfaEnabledAt: Date | string | null;
  mfaTotpSecretEnc: string | null;
}): boolean {
  return user.mfaEnabledAt != null && Boolean(user.mfaTotpSecretEnc);
}

export async function userSubjectToMfaEnforcement(
  db: Db,
  userId: number,
  enforcement?: MfaEnforcement,
): Promise<boolean> {
  const policy = enforcement ?? (await getSystemProperties(db)).mfaEnforcement;
  if (policy !== "administrators") return false;
  return userIsAdministrator(db, userId);
}

export function graceDeadline(
  graceStartedAt: Date,
  graceDays: number,
): Date {
  return new Date(graceStartedAt.getTime() + graceDays * 24 * 60 * 60 * 1000);
}

export function isPastMfaGrace(
  graceStartedAt: Date | null,
  graceDays: number,
  now = new Date(),
): boolean {
  if (graceStartedAt == null) return false;
  return now.getTime() >= graceDeadline(graceStartedAt, graceDays).getTime();
}

export type PostPrimaryAuthResult =
  | { kind: "session"; mfaEnrollmentRequired: boolean; graceEndsAt: string | null }
  | { kind: "mfa_challenge"; challengeId: string }
  | { kind: "mfa_locked"; message: string };

/**
 * After password/OAuth primary success: MFA challenge, grace session, lock, or session.
 * Caller must not mint a session when kind !== "session".
 */
export async function resolvePostPrimaryAuth(
  db: Db,
  user: typeof schema.users.$inferSelect,
): Promise<PostPrimaryAuthResult> {
  if (user.lockedAt != null) {
    if (user.lockReason === "mfa_deadline") {
      return { kind: "mfa_locked", message: MFA_LOCKED_MESSAGE };
    }
    return {
      kind: "mfa_locked",
      message: "Your account is locked. Contact an administrator.",
    };
  }

  if (isMfaEnrolled(user)) {
    const challengeId = await createMfaChallenge(db, user.id);
    return { kind: "mfa_challenge", challengeId };
  }

  const props = await getSystemProperties(db);
  const enforced = await userSubjectToMfaEnforcement(db, user.id, props.mfaEnforcement);
  if (!enforced) {
    return { kind: "session", mfaEnrollmentRequired: false, graceEndsAt: null };
  }

  let graceStarted = user.mfaGraceStartedAt;
  if (graceStarted == null) {
    const now = new Date();
    const [updated] = await db
      .update(schema.users)
      .set({ mfaGraceStartedAt: now, updatedAt: now })
      .where(eq(schema.users.id, user.id))
      .returning();
    graceStarted = updated?.mfaGraceStartedAt ?? now;
  }

  if (isPastMfaGrace(graceStarted, props.mfaGraceDays)) {
    const now = new Date();
    await db
      .update(schema.users)
      .set({
        lockedAt: now,
        lockReason: "mfa_deadline",
        updatedAt: now,
      })
      .where(eq(schema.users.id, user.id));
    return { kind: "mfa_locked", message: MFA_LOCKED_MESSAGE };
  }

  return {
    kind: "session",
    mfaEnrollmentRequired: true,
    graceEndsAt: graceDeadline(graceStarted, props.mfaGraceDays).toISOString(),
  };
}

export async function createMfaChallenge(db: Db, userId: number): Promise<string> {
  await db
    .delete(schema.mfaLoginChallenges)
    .where(
      and(
        eq(schema.mfaLoginChallenges.userId, userId),
        isNull(schema.mfaLoginChallenges.consumedAt),
      ),
    );
  const id = newChallengeId();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await db.insert(schema.mfaLoginChallenges).values({ id, userId, expiresAt });
  return id;
}

export async function verifyMfaChallenge(
  db: Db,
  challengeId: string,
  code: string,
): Promise<{ userId: number }> {
  const [challenge] = await db
    .select()
    .from(schema.mfaLoginChallenges)
    .where(eq(schema.mfaLoginChallenges.id, challengeId))
    .limit(1);
  if (!challenge || challenge.consumedAt != null) {
    throw serviceErr("Invalid or expired MFA challenge.", 401, "mfa_challenge_invalid");
  }
  if (challenge.expiresAt.getTime() <= Date.now()) {
    await db
      .delete(schema.mfaLoginChallenges)
      .where(eq(schema.mfaLoginChallenges.id, challengeId));
    throw serviceErr("MFA challenge expired. Sign in again.", 401, "mfa_challenge_expired");
  }
  if (challenge.failedAttempts >= MAX_CHALLENGE_ATTEMPTS) {
    throw serviceErr("Too many MFA attempts. Sign in again.", 401, "mfa_challenge_locked");
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, challenge.userId))
    .limit(1);
  if (!user || !isMfaEnrolled(user) || !user.mfaTotpSecretEnc) {
    throw serviceErr("Invalid or expired MFA challenge.", 401, "mfa_challenge_invalid");
  }
  if (user.lockedAt != null || user.deactivatedAt != null) {
    throw serviceErr("Your account is locked. Contact an administrator.", 403, "account_locked");
  }

  let secret: string;
  try {
    secret = decryptMfaSecret(user.mfaTotpSecretEnc);
  } catch {
    throw serviceErr("MFA is misconfigured on the server.", 500, "mfa_misconfigured");
  }

  if (!verifyTotpCode(secret, code)) {
    await db
      .update(schema.mfaLoginChallenges)
      .set({ failedAttempts: challenge.failedAttempts + 1 })
      .where(eq(schema.mfaLoginChallenges.id, challengeId));
    throw serviceErr("Invalid authenticator code.", 401, "mfa_invalid_code");
  }

  const now = new Date();
  await db
    .update(schema.mfaLoginChallenges)
    .set({ consumedAt: now })
    .where(eq(schema.mfaLoginChallenges.id, challengeId));

  return { userId: user.id };
}

export type MfaStatus = {
  enrolled: boolean;
  enabledAt: string | null;
  enforcementApplies: boolean;
  graceStartedAt: string | null;
  graceEndsAt: string | null;
  enrollmentRequired: boolean;
  canDisable: boolean;
  serverKeyConfigured: boolean;
};

export async function getMfaStatus(
  db: Db,
  user: typeof schema.users.$inferSelect,
): Promise<MfaStatus> {
  const props = await getSystemProperties(db);
  const enforcementApplies = await userSubjectToMfaEnforcement(
    db,
    user.id,
    props.mfaEnforcement,
  );
  const enrolled = isMfaEnrolled(user);
  let graceEndsAt: string | null = null;
  let enrollmentRequired = false;
  if (enforcementApplies && !enrolled && user.mfaGraceStartedAt) {
    graceEndsAt = graceDeadline(user.mfaGraceStartedAt, props.mfaGraceDays).toISOString();
    enrollmentRequired = true;
  } else if (enforcementApplies && !enrolled) {
    enrollmentRequired = true;
  }
  return {
    enrolled,
    enabledAt: user.mfaEnabledAt?.toISOString() ?? null,
    enforcementApplies,
    graceStartedAt: user.mfaGraceStartedAt?.toISOString() ?? null,
    graceEndsAt,
    enrollmentRequired,
    canDisable: enrolled && !enforcementApplies,
    serverKeyConfigured: hasMfaTotpKey(),
  };
}

export type MfaEnrollStart = {
  secret: string;
  otpauthUri: string;
};

/** Begin enrollment: returns plaintext secret once (not persisted until confirm). */
export async function startMfaEnrollment(
  db: Db,
  user: typeof schema.users.$inferSelect,
): Promise<MfaEnrollStart> {
  if (!hasMfaTotpKey()) {
    throw serviceErr(MFA_ENROLL_KEY_MESSAGE, 503, "mfa_key_missing");
  }
  if (isMfaEnrolled(user)) {
    throw serviceErr("MFA is already enrolled. Disable it before re-enrolling.", 409, "mfa_already_enrolled");
  }
  const secret = generateTotpSecret();
  const label = user.email?.trim() || user.displayName || `U${user.number}`;
  // Stash pending secret encrypted on the user row temporarily via a challenge-like
  // approach: store encrypted secret with mfaEnabledAt still null.
  const enc = encryptMfaSecret(secret);
  const now = new Date();
  await db
    .update(schema.users)
    .set({ mfaTotpSecretEnc: enc, mfaEnabledAt: null, updatedAt: now })
    .where(eq(schema.users.id, user.id));
  return { secret, otpauthUri: totpUri(secret, label) };
}

export async function confirmMfaEnrollment(
  db: Db,
  userId: number,
  code: string,
): Promise<void> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user?.mfaTotpSecretEnc || user.mfaEnabledAt != null) {
    throw serviceErr("No MFA enrollment in progress. Start enrollment again.", 400, "mfa_not_pending");
  }
  let secret: string;
  try {
    secret = decryptMfaSecret(user.mfaTotpSecretEnc);
  } catch {
    throw serviceErr("MFA is misconfigured on the server.", 500, "mfa_misconfigured");
  }
  if (!verifyTotpCode(secret, code)) {
    throw serviceErr("Invalid authenticator code.", 400, "mfa_invalid_code");
  }
  const now = new Date();
  await db
    .update(schema.users)
    .set({
      mfaEnabledAt: now,
      mfaGraceStartedAt: null,
      updatedAt: now,
    })
    .where(eq(schema.users.id, userId));
}

export async function disableMfa(
  db: Db,
  userId: number,
  code: string,
): Promise<void> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user || !isMfaEnrolled(user) || !user.mfaTotpSecretEnc) {
    throw serviceErr("MFA is not enrolled.", 400, "mfa_not_enrolled");
  }
  if (await userSubjectToMfaEnforcement(db, userId)) {
    throw serviceErr(
      "MFA is required for your account and cannot be disabled. Ask an administrator to clear MFA if needed.",
      403,
      "mfa_required",
    );
  }
  let secret: string;
  try {
    secret = decryptMfaSecret(user.mfaTotpSecretEnc);
  } catch {
    throw serviceErr("MFA is misconfigured on the server.", 500, "mfa_misconfigured");
  }
  if (!verifyTotpCode(secret, code)) {
    throw serviceErr("Invalid authenticator code.", 400, "mfa_invalid_code");
  }
  await clearMfaForUser(db, userId);
}

export async function clearMfaForUser(db: Db, userId: number): Promise<void> {
  const now = new Date();
  await db
    .update(schema.users)
    .set({
      mfaTotpSecretEnc: null,
      mfaEnabledAt: null,
      updatedAt: now,
    })
    .where(eq(schema.users.id, userId));
  await db
    .delete(schema.mfaLoginChallenges)
    .where(eq(schema.mfaLoginChallenges.userId, userId));
}

/** Cancel in-progress enrollment (pending secret, not yet confirmed). */
export async function cancelMfaEnrollment(db: Db, userId: number): Promise<void> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user || user.mfaEnabledAt != null) return;
  if (!user.mfaTotpSecretEnc) return;
  await db
    .update(schema.users)
    .set({
      mfaTotpSecretEnc: null,
      mfaEnabledAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
}

/**
 * API key create gate: enforced Administrators must have MFA enrolled.
 */
export async function assertMayCreateApiKey(
  db: Db,
  user: typeof schema.users.$inferSelect,
): Promise<void> {
  if (!(await userSubjectToMfaEnforcement(db, user.id))) return;
  if (isMfaEnrolled(user)) return;
  throw serviceErr(
    "Enroll multi-factor authentication before creating API keys.",
    403,
    "mfa_required_for_api_keys",
  );
}

/**
 * After owner lock/auth checks: deny keys when MFA grace expired without enroll
 * (account should already be locked via interactive path; belt-and-suspenders).
 */
export async function assertApiKeyOwnerMfaOk(
  db: Db,
  user: typeof schema.users.$inferSelect,
): Promise<void> {
  if (!(await userSubjectToMfaEnforcement(db, user.id))) return;
  if (isMfaEnrolled(user)) return;
  const props = await getSystemProperties(db);
  if (isPastMfaGrace(user.mfaGraceStartedAt, props.mfaGraceDays)) {
    throw Object.assign(new Error("Invalid API key"), {
      status: 401,
      code: "invalid_api_key",
    });
  }
}

/** Sweep expired unconsumed challenges (optional housekeeping). */
export async function purgeExpiredMfaChallenges(db: Db): Promise<void> {
  await db
    .delete(schema.mfaLoginChallenges)
    .where(lt(schema.mfaLoginChallenges.expiresAt, new Date()));
}
