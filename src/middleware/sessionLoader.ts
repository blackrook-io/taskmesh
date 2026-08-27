import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client.js";
import { requestAuthContext } from "../lib/requestAuthContext.js";
import { readSessionCookie } from "../lib/sessionCookie.js";
import { getSessionById } from "../services/auth.js";

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
        sessionUserId = session.userId;
        req.sessionId = sessionId;
        req.sessionUserId = sessionUserId;
      }
    }
    requestAuthContext.run({ sessionUserId }, () => {
      next();
    });
  } catch (err) {
    next(err);
  }
}
