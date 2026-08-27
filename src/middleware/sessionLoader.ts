import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client.js";
import { userCanAuthenticate } from "../lib/userAuth.js";
import { requestAuthContext } from "../lib/requestAuthContext.js";
import { clearSessionCookie, readSessionCookie } from "../lib/sessionCookie.js";
import { destroySession, getSessionById, getUserById } from "../services/auth.js";

export async function sessionLoader(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const sessionId = readSessionCookie(req);
    let sessionUserId: number | undefined;
    if (sessionId) {
      const session = await getSessionById(db, sessionId);
      if (session) {
        const user = await getUserById(db, session.userId);
        if (user && userCanAuthenticate(user)) {
          sessionUserId = session.userId;
          req.sessionId = sessionId;
          req.sessionUserId = sessionUserId;
        } else {
          await destroySession(db, sessionId);
          clearSessionCookie(res);
        }
      } else {
        clearSessionCookie(res);
      }
    }
    requestAuthContext.run({ sessionUserId, apiKeyUserId: req.apiKeyUserId }, () => {
      next();
    });
  } catch (err) {
    next(err);
  }
}
