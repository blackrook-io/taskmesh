import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { AUTH_REQUIRED_MESSAGE } from "../../lib/authErrors.js";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "../../lib/sessionCookie.js";
import { toUserProfile } from "../../lib/userFields.js";
import { attachRolesToProfile } from "../../services/roles.js";
import { userCanAuthenticate } from "../../lib/userAuth.js";
import { loginRateLimit } from "../../middleware/rateLimits.js";
import {
  createSession,
  destroySession,
  getUserById,
  loginWithEmailPassword,
} from "../../services/auth.js";
import {
  completeOauthCallback,
  safeOauthReturnTo,
  startOauthFlow,
} from "../../services/oauth/flow.js";
import { isOauthSlug, listPublicOauthProviders } from "../../services/oauth/providers.js";

const loginBody = z
  .object({
    email: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(200),
  })
  .strict();

async function profileForUser(user: typeof schema.users.$inferSelect) {
  let avatarStoredName: string | null = null;
  if (user.avatarUploadId != null) {
    const [upload] = await db
      .select({ storedName: schema.uploads.storedName })
      .from(schema.uploads)
      .where(eq(schema.uploads.id, user.avatarUploadId))
      .limit(1);
    avatarStoredName = upload?.storedName ?? null;
  }
  return attachRolesToProfile(db, toUserProfile(user, avatarStoredName), user.id);
}

function serviceError(res: Parameters<typeof sendError>[0], err: unknown): boolean {
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    "code" in err &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    const e = err as { status: number; code: string; message: string };
    sendError(res, e.status, e.code, e.message);
    return true;
  }
  return false;
}

function loginRedirect(errorCode?: string, returnTo?: string): string {
  const params = new URLSearchParams();
  if (errorCode) params.set("error", errorCode);
  const rt = safeOauthReturnTo(returnTo ?? null);
  if (rt !== "/") params.set("returnTo", rt);
  const q = params.toString();
  return q ? `/login?${q}` : "/login";
}

export const authRouter = Router();

authRouter.post("/login", loginRateLimit, async (req, res) => {
  try {
    const { email, password } = loginBody.parse(req.body);
    const user = await loginWithEmailPassword(db, email, password);
    const session = await createSession(db, user.id);
    setSessionCookie(res, session.id, session.maxAgeSeconds);
    res.locals.logUserId = user.id;
    res.locals.logMessage = `User login: ${user.displayName}`;
    res.json({ data: await profileForUser(user) });
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

authRouter.post("/logout", async (req, res) => {
  try {
    const sessionId = req.sessionId ?? readSessionCookie(req);
    if (sessionId) {
      await destroySession(db, sessionId);
    }
    clearSessionCookie(res);
    res.status(204).send();
  } catch (err) {
    handleRouteError(res, err);
  }
});

authRouter.get("/session", async (req, res) => {
  try {
    const userId = req.sessionUserId;
    if (userId == null) {
      sendError(res, 401, "not_authenticated", AUTH_REQUIRED_MESSAGE);
      return;
    }
    const user = await getUserById(db, userId);
    if (!user || !userCanAuthenticate(user)) {
      if (req.sessionId) {
        await destroySession(db, req.sessionId);
      }
      clearSessionCookie(res);
      sendError(res, 401, "not_authenticated", AUTH_REQUIRED_MESSAGE);
      return;
    }
    res.json({ data: await profileForUser(user) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

authRouter.get("/oauth/providers", async (_req, res) => {
  try {
    res.json({ data: await listPublicOauthProviders(db) });
  } catch (err) {
    handleRouteError(res, err);
  }
});

authRouter.get("/oauth/:slug/start", loginRateLimit, async (req, res) => {
  try {
    const slug = String(req.params.slug ?? "");
    if (!isOauthSlug(slug)) {
      sendError(res, 404, "not_found", "Unknown OAuth provider.");
      return;
    }
    const mode = req.query.mode === "link" ? "link" : "login";
    const returnTo =
      typeof req.query.returnTo === "string" ? req.query.returnTo : null;
    if (mode === "link" && req.sessionUserId == null) {
      sendError(res, 401, "not_authenticated", AUTH_REQUIRED_MESSAGE);
      return;
    }
    const { redirectUrl } = await startOauthFlow(db, {
      slug,
      req,
      mode,
      returnTo,
      linkUserId: mode === "link" ? req.sessionUserId : null,
    });
    res.redirect(302, redirectUrl);
  } catch (err) {
    if (serviceError(res, err)) return;
    handleRouteError(res, err);
  }
});

async function handleOauthCallback(
  req: import("express").Request,
  res: import("express").Response,
) {
  const slug = String(req.params.slug ?? "");
  if (!isOauthSlug(slug)) {
    res.redirect(302, loginRedirect("oauth_failed"));
    return;
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const code =
    typeof req.query.code === "string"
      ? req.query.code
      : typeof (body as { code?: unknown }).code === "string"
        ? (body as { code: string }).code
        : null;
  const state =
    typeof req.query.state === "string"
      ? req.query.state
      : typeof (body as { state?: unknown }).state === "string"
        ? (body as { state: string }).state
        : null;
  const error =
    typeof req.query.error === "string"
      ? req.query.error
      : typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : null;
  const appleUser =
    typeof (body as { user?: unknown }).user === "string"
      ? (body as { user: string }).user
      : typeof req.query.user === "string"
        ? req.query.user
        : null;

  const result = await completeOauthCallback(db, {
    slug,
    req,
    code,
    state,
    error,
    appleUserJson: appleUser,
  });

  if (!result.ok) {
    res.redirect(302, loginRedirect(result.errorCode));
    return;
  }

  if (result.mode === "login") {
    setSessionCookie(res, result.sessionId, result.maxAgeSeconds);
    res.locals.logMessage = `OAuth login (${slug})`;
    res.redirect(302, result.returnTo);
    return;
  }

  res.redirect(302, result.returnTo);
}

authRouter.get("/oauth/:slug/callback", async (req, res) => {
  try {
    await handleOauthCallback(req, res);
  } catch (err) {
    handleRouteError(res, err);
  }
});

authRouter.post("/oauth/:slug/callback", async (req, res) => {
  try {
    await handleOauthCallback(req, res);
  } catch (err) {
    handleRouteError(res, err);
  }
});
