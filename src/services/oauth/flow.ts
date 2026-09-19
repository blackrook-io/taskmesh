import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Request } from "express";
import * as client from "openid-client";
import * as schema from "../../db/schema.js";
import { userCanAuthenticate } from "../../lib/userAuth.js";
import { createSession } from "../auth.js";
import { resolvePostPrimaryAuth } from "../mfa.js";
import { assignRole, createRole, listRoles } from "../roles.js";
import { allocateUserNumber } from "../users.js";
import { buildAuthorizationUrl, exchangeCodeForIdentity } from "./adapters.js";
import {
  getOauthProviderBySlug,
  type OauthProviderRow,
} from "./providers.js";

type Db = NodePgDatabase<typeof schema>;

const STATE_TTL_MS = 10 * 60 * 1000;

function serviceErr(message: string, status: number, code: string): Error {
  return Object.assign(new Error(message), { status, code });
}

export function safeOauthReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/login")) return "/";
  return raw;
}

/** Public origin for OAuth redirect_uri registration. */
export function oauthPublicBaseUrl(req: Request): string {
  const fromEnv = process.env.OAUTH_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const proto =
    (req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0]?.trim() ||
    "http";
  const host = req.get("x-forwarded-host") || req.get("host");
  if (!host) {
    throw serviceErr("Cannot determine public base URL for OAuth.", 500, "oauth_misconfigured");
  }
  return `${proto}://${host}`;
}

export function oauthCallbackPath(slug: string): string {
  return `/api/v1/auth/oauth/${slug}/callback`;
}

export function oauthRedirectUri(req: Request, slug: string): string {
  return `${oauthPublicBaseUrl(req)}${oauthCallbackPath(slug)}`;
}

async function ensureEditorRoleId(db: Db): Promise<number> {
  const roles = await listRoles(db);
  const existing = roles.find((r) => r.slug === "editor");
  if (existing) return existing.id;
  const created = await createRole(db, "Editor");
  return created.id;
}

async function resolveJitRoleId(db: Db, provider: OauthProviderRow): Promise<number> {
  if (provider.defaultRoleId != null) return provider.defaultRoleId;
  return ensureEditorRoleId(db);
}

export async function startOauthFlow(
  db: Db,
  opts: {
    slug: string;
    req: Request;
    mode: "login" | "link";
    returnTo?: string | null;
    linkUserId?: number | null;
  },
): Promise<{ redirectUrl: string }> {
  const provider = await getOauthProviderBySlug(db, opts.slug);
  if (!provider || !provider.enabled) {
    throw serviceErr("OAuth provider is not available.", 404, "not_found");
  }
  if (!provider.clientId) {
    throw serviceErr("OAuth provider is not configured.", 400, "oauth_misconfigured");
  }
  if (opts.mode === "link" && opts.linkUserId == null) {
    throw serviceErr("Authentication required.", 401, "not_authenticated");
  }

  const state = client.randomState();
  const codeVerifier = client.randomPKCECodeVerifier();
  const nonce = provider.slug === "github" ? null : client.randomNonce();
  const returnTo = safeOauthReturnTo(opts.returnTo ?? null);
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);

  await db.insert(schema.oauthLoginStates).values({
    state,
    providerId: provider.id,
    codeVerifier,
    nonce,
    returnTo,
    mode: opts.mode,
    userId: opts.mode === "link" ? opts.linkUserId! : null,
    expiresAt,
  });

  const redirectUri = oauthRedirectUri(opts.req, provider.slug);
  const url = await buildAuthorizationUrl({
    provider,
    redirectUri,
    state,
    codeVerifier,
    nonce,
  });
  return { redirectUrl: url.toString() };
}

export type OauthCallbackResult =
  | {
      ok: true;
      returnTo: string;
      sessionId: string;
      maxAgeSeconds: number;
      mode: "login";
      mfaEnrollmentRequired?: boolean;
    }
  | { ok: true; returnTo: string; mode: "login"; mfaChallengeId: string }
  | { ok: true; returnTo: string; mode: "link" }
  | { ok: false; errorCode: string };

export async function completeOauthCallback(
  db: Db,
  opts: {
    slug: string;
    req: Request;
    code: string | null;
    state: string | null;
    error?: string | null;
    appleUserJson?: string | null;
  },
): Promise<OauthCallbackResult> {
  if (opts.error) {
    return { ok: false, errorCode: "oauth_denied" };
  }
  if (!opts.code || !opts.state) {
    return { ok: false, errorCode: "oauth_failed" };
  }

  const [stateRow] = await db
    .select()
    .from(schema.oauthLoginStates)
    .where(eq(schema.oauthLoginStates.state, opts.state))
    .limit(1);

  if (!stateRow || stateRow.expiresAt.getTime() <= Date.now()) {
    if (stateRow) {
      await db.delete(schema.oauthLoginStates).where(eq(schema.oauthLoginStates.state, opts.state));
    }
    return { ok: false, errorCode: "oauth_expired" };
  }

  await db.delete(schema.oauthLoginStates).where(eq(schema.oauthLoginStates.state, opts.state));

  const provider = await getOauthProviderBySlug(db, opts.slug);
  if (!provider || provider.id !== stateRow.providerId || !provider.enabled) {
    return { ok: false, errorCode: "oauth_failed" };
  }

  let identity;
  try {
    identity = await exchangeCodeForIdentity({
      provider,
      redirectUri: oauthRedirectUri(opts.req, provider.slug),
      code: opts.code,
      state: opts.state,
      codeVerifier: stateRow.codeVerifier,
      nonce: stateRow.nonce,
      appleUserJson: opts.appleUserJson,
    });
  } catch (err) {
    const code =
      typeof err === "object" && err && "code" in err
        ? String((err as { code: string }).code)
        : "oauth_failed";
    return { ok: false, errorCode: code === "oauth_misconfigured" ? code : "oauth_failed" };
  }

  const returnTo = safeOauthReturnTo(stateRow.returnTo);

  if (stateRow.mode === "link") {
    if (stateRow.userId == null) return { ok: false, errorCode: "oauth_failed" };
    try {
      await linkIdentity(db, stateRow.userId, provider, identity);
    } catch (err) {
      const code =
        typeof err === "object" && err && "code" in err
          ? String((err as { code: string }).code)
          : "oauth_failed";
      return {
        ok: false,
        errorCode:
          code === "oauth_conflict" || code === "oauth_last_factor" ? code : "oauth_failed",
      };
    }
    return { ok: true, returnTo: returnTo === "/" ? "/settings/profile" : returnTo, mode: "link" };
  }

  const user = await resolveLoginUser(db, provider, identity);
  if (!user) return { ok: false, errorCode: "oauth_no_account" };
  if (user.deactivatedAt != null) return { ok: false, errorCode: "oauth_failed" };
  if (user.lockedAt != null) {
    return {
      ok: false,
      errorCode: user.lockReason === "mfa_deadline" ? "mfa_locked" : "account_locked",
    };
  }
  if (!userCanAuthenticate(user)) return { ok: false, errorCode: "oauth_failed" };

  const now = new Date();
  const [updated] = await db
    .update(schema.users)
    .set({ failedLoginCount: 0, lastLoginAt: now, updatedAt: now })
    .where(eq(schema.users.id, user.id))
    .returning();
  const fresh = updated ?? user;

  const post = await resolvePostPrimaryAuth(db, fresh);
  if (post.kind === "mfa_locked") {
    return {
      ok: false,
      errorCode: "mfa_locked",
    };
  }
  if (post.kind === "mfa_challenge") {
    return {
      ok: true,
      returnTo,
      mode: "login",
      mfaChallengeId: post.challengeId,
    };
  }

  const session = await createSession(db, fresh.id);
  return {
    ok: true,
    returnTo,
    sessionId: session.id,
    maxAgeSeconds: session.maxAgeSeconds,
    mode: "login",
    mfaEnrollmentRequired: post.mfaEnrollmentRequired,
  };
}

async function linkIdentity(
  db: Db,
  userId: number,
  provider: OauthProviderRow,
  identity: { subject: string; email: string; raw: Record<string, unknown> },
): Promise<void> {
  const [existingSub] = await db
    .select()
    .from(schema.userIdentities)
    .where(
      and(
        eq(schema.userIdentities.providerId, provider.id),
        eq(schema.userIdentities.subject, identity.subject),
      ),
    )
    .limit(1);
  if (existingSub && existingSub.userId !== userId) {
    throw serviceErr("This identity is already linked to another user.", 409, "oauth_conflict");
  }
  if (existingSub) return;

  const [existingProv] = await db
    .select()
    .from(schema.userIdentities)
    .where(
      and(
        eq(schema.userIdentities.userId, userId),
        eq(schema.userIdentities.providerId, provider.id),
      ),
    )
    .limit(1);
  if (existingProv) {
    throw serviceErr("This provider is already linked to your account.", 409, "oauth_conflict");
  }

  await db.insert(schema.userIdentities).values({
    userId,
    providerId: provider.id,
    subject: identity.subject,
    emailAtLink: identity.email,
    rawProfile: sanitizeRaw(identity.raw),
  });
}

function sanitizeRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...raw };
  for (const k of Object.keys(copy)) {
    const lk = k.toLowerCase();
    if (lk.includes("token") || lk.includes("secret") || lk.includes("password")) {
      delete copy[k];
    }
  }
  return copy;
}

async function resolveLoginUser(
  db: Db,
  provider: OauthProviderRow,
  identity: {
    subject: string;
    email: string;
    displayName: string | null;
    raw: Record<string, unknown>;
  },
): Promise<typeof schema.users.$inferSelect | null> {
  const [bySubject] = await db
    .select({
      identity: schema.userIdentities,
      user: schema.users,
    })
    .from(schema.userIdentities)
    .innerJoin(schema.users, eq(schema.userIdentities.userId, schema.users.id))
    .where(
      and(
        eq(schema.userIdentities.providerId, provider.id),
        eq(schema.userIdentities.subject, identity.subject),
      ),
    )
    .limit(1);
  if (bySubject) return bySubject.user;

  const [byEmail] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${identity.email}`)
    .limit(1);

  if (byEmail) {
    await db.insert(schema.userIdentities).values({
      userId: byEmail.id,
      providerId: provider.id,
      subject: identity.subject,
      emailAtLink: identity.email,
      rawProfile: sanitizeRaw(identity.raw),
    });
    return byEmail;
  }

  if (!provider.jitEnabled) return null;

  const number = await allocateUserNumber(db);
  const displayName =
    identity.displayName?.trim() || identity.email.split("@")[0] || `User ${number}`;
  const [created] = await db
    .insert(schema.users)
    .values({
      number,
      displayName,
      email: identity.email,
      passwordHash: null,
    })
    .returning();
  if (!created) return null;

  const roleId = await resolveJitRoleId(db, provider);
  await assignRole(db, created.id, roleId);

  await db.insert(schema.userIdentities).values({
    userId: created.id,
    providerId: provider.id,
    subject: identity.subject,
    emailAtLink: identity.email,
    rawProfile: sanitizeRaw(identity.raw),
  });
  return created;
}

export type UserIdentityView = {
  id: number;
  providerSlug: string;
  providerName: string;
  emailAtLink: string | null;
  linkedAt: string;
};

export async function listIdentitiesForUser(
  db: Db,
  userId: number,
): Promise<UserIdentityView[]> {
  const rows = await db
    .select({
      id: schema.userIdentities.id,
      emailAtLink: schema.userIdentities.emailAtLink,
      linkedAt: schema.userIdentities.linkedAt,
      providerSlug: schema.oauthProviders.slug,
      providerName: schema.oauthProviders.name,
    })
    .from(schema.userIdentities)
    .innerJoin(
      schema.oauthProviders,
      eq(schema.userIdentities.providerId, schema.oauthProviders.id),
    )
    .where(eq(schema.userIdentities.userId, userId));

  return rows.map((r) => ({
    id: r.id,
    providerSlug: r.providerSlug,
    providerName: r.providerName,
    emailAtLink: r.emailAtLink,
    linkedAt: r.linkedAt.toISOString(),
  }));
}

export async function unlinkIdentity(
  db: Db,
  userId: number,
  identityId: number,
): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.userIdentities)
    .where(
      and(eq(schema.userIdentities.id, identityId), eq(schema.userIdentities.userId, userId)),
    )
    .limit(1);
  if (!row) throw serviceErr("Linked account not found.", 404, "not_found");

  const [user] = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const identities = await db
    .select({ id: schema.userIdentities.id })
    .from(schema.userIdentities)
    .where(eq(schema.userIdentities.userId, userId));

  const hasPassword = Boolean(user?.passwordHash);
  if (!hasPassword && identities.length <= 1) {
    throw serviceErr(
      "Cannot unlink the last sign-in method. Set a password first or link another provider.",
      400,
      "oauth_last_factor",
    );
  }

  await db.delete(schema.userIdentities).where(eq(schema.userIdentities.id, identityId));
}
