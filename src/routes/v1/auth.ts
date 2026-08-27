import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { handleRouteError, sendError } from "../../lib/httpError.js";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "../../lib/sessionCookie.js";
import { toUserProfile } from "../../lib/userFields.js";
import { userCanAuthenticate } from "../../lib/userAuth.js";
import {
  createSession,
  destroySession,
  getUserById,
  loginWithEmailPassword,
  LOGIN_ERROR_MESSAGE,
} from "../../services/auth.js";

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
  return toUserProfile(user, avatarStoredName);
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

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
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
      sendError(res, 401, "not_authenticated", LOGIN_ERROR_MESSAGE);
      return;
    }
    const user = await getUserById(db, userId);
    if (!user || !userCanAuthenticate(user)) {
      if (req.sessionId) {
        await destroySession(db, req.sessionId);
      }
      clearSessionCookie(res);
      sendError(res, 401, "not_authenticated", LOGIN_ERROR_MESSAGE);
      return;
    }
    res.json({ data: await profileForUser(user) });
  } catch (err) {
    handleRouteError(res, err);
  }
});
