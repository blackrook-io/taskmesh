import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import { validatePassword, hashPassword } from "../lib/password.js";
import { isEmailSignupAvailable, MailError } from "./mail/settings.js";
import { enqueueOutboundMail } from "./mail/outbound.js";
import { allocateUniqueDisplayName, allocateUserNumber } from "./users.js";

type Db = NodePgDatabase<typeof schema>;

export const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;

const INVALID_TOKEN = "This confirmation link is invalid or has expired.";

function signupError(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code });
}

export function hashConfirmToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newConfirmToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Display name from the mailbox local part. Falls back to "User". */
export function signupDisplayName(email: string): string {
  const local = email.split("@")[0] ?? "";
  const cleaned = local
    .replace(/[^\p{L}\p{N} ._' -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "User").slice(0, 180);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function postgresConstraint(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ("code" in current && (current as { code?: unknown }).code === "23505") {
      const constraint = (current as { constraint?: unknown }).constraint;
      return typeof constraint === "string" ? constraint : "unique";
    }
    current = "cause" in current ? (current as { cause: unknown }).cause : null;
  }
  return null;
}

async function findUserByEmail(db: Db, email: string) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`)
    .limit(1);
  return user ?? null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function confirmationMessage(link: string): { text: string; html: string } {
  const text = [
    "Confirm your TaskMesh account by opening this link:",
    "",
    link,
    "",
    "This link expires in 24 hours. If you did not sign up, you can ignore this message.",
  ].join("\n");
  const href = escapeHtml(link);
  const html = `<p>Confirm your TaskMesh account by opening this link:</p><p><a href="${href}">Confirm your email</a></p><p>This link expires in 24 hours. If you did not sign up, you can ignore this message.</p>`;
  return { text, html };
}

async function issueConfirmToken(
  db: Db,
  userId: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newConfirmToken();
  const expiresAt = new Date(Date.now() + CONFIRM_TTL_MS);
  await db
    .update(schema.users)
    .set({
      emailConfirmTokenHash: hashConfirmToken(token),
      emailConfirmExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
  return { token, expiresAt };
}

async function sendConfirmation(
  db: Db,
  email: string,
  publicBaseUrl: string,
  token: string,
): Promise<void> {
  const link = `${publicBaseUrl.replace(/\/$/, "")}/login?confirm=${encodeURIComponent(token)}`;
  const message = confirmationMessage(link);
  await enqueueOutboundMail(db, {
    to: email,
    subject: "Confirm your TaskMesh account",
    text: message.text,
    html: message.html,
    kind: "outbound",
  });
}

/**
 * Create an unconfirmed account, or refresh the link for one that is still pending.
 * A verified address gets the same accepted response and no message.
 */
export async function requestEmailSignup(
  db: Db,
  input: { email: string; password: string; publicBaseUrl: string },
): Promise<{ accepted: true }> {
  const open = await isEmailSignupAvailable(db);
  if (!open) {
    throw signupError(403, "signup_unavailable", "Email signup is not available.");
  }
  const passwordError = validatePassword(input.password);
  if (passwordError) {
    throw signupError(400, "invalid_password", passwordError);
  }
  const email = normalizeEmail(input.email);
  const existing = await findUserByEmail(db, email);
  if (existing?.emailVerifiedAt) {
    return { accepted: true };
  }

  let userId: number;
  let created = false;
  if (existing) {
    userId = existing.id;
  } else {
    const number = await allocateUserNumber(db);
    const displayName = await allocateUniqueDisplayName(db, signupDisplayName(email));
    const passwordHash = await hashPassword(input.password);
    try {
      const [row] = await db
        .insert(schema.users)
        .values({
          number,
          displayName,
          email,
          passwordHash,
          emailVerifiedAt: null,
        })
        .returning({ id: schema.users.id });
      if (!row) {
        throw signupError(500, "signup_failed", "Could not create the account.");
      }
      userId = row.id;
      created = true;
    } catch (err) {
      if (!postgresConstraint(err)) throw err;
      const again = await findUserByEmail(db, email);
      if (!again) throw err;
      if (again.emailVerifiedAt) return { accepted: true };
      userId = again.id;
    }
  }

  const { token } = await issueConfirmToken(db, userId);
  const deliverTo = existing?.email?.trim() || email;
  try {
    await sendConfirmation(db, deliverTo, input.publicBaseUrl, token);
  } catch (err) {
    if (created) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
    if (err instanceof MailError) throw err;
    throw signupError(
      503,
      "signup_mail_failed",
      "Could not send the confirmation email. Try again later.",
    );
  }
  return { accepted: true };
}

/** Activate the account for a single-use confirmation token. */
export async function confirmEmailSignup(
  db: Db,
  token: string,
): Promise<{ confirmed: true }> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 200) {
    throw signupError(400, "invalid_token", INVALID_TOKEN);
  }
  const tokenHash = hashConfirmToken(trimmed);
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.emailConfirmTokenHash, tokenHash))
    .limit(1);
  if (
    !user ||
    user.emailConfirmExpiresAt == null ||
    user.emailConfirmExpiresAt.getTime() <= Date.now()
  ) {
    throw signupError(400, "invalid_token", INVALID_TOKEN);
  }
  if (user.deactivatedAt != null) {
    throw signupError(403, "account_locked", "Your account is locked. Contact an administrator.");
  }
  const now = new Date();
  const [updated] = await db
    .update(schema.users)
    .set({
      emailVerifiedAt: now,
      emailConfirmTokenHash: null,
      emailConfirmExpiresAt: null,
      updatedAt: now,
    })
    .where(and(eq(schema.users.id, user.id), eq(schema.users.emailConfirmTokenHash, tokenHash)))
    .returning({ id: schema.users.id });
  if (!updated) {
    throw signupError(400, "invalid_token", INVALID_TOKEN);
  }
  return { confirmed: true };
}
