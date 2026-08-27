import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client.js";
import { AUTH_REQUIRED_MESSAGE } from "../lib/authErrors.js";
import { sendError } from "../lib/httpError.js";
import { userHasAdministrator } from "../services/roles.js";

export const NOT_ADMINISTRATOR_MESSAGE = "Administrator role required.";

/**
 * Restrict a router to users who hold the system Administrator role (T0108).
 * Session and API-key callers are both resolved via the authenticated user id.
 */
export async function requireAdministrator(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKeyUserId ?? req.sessionUserId;
    if (userId == null) {
      res.locals.logMessage = "Unauthenticated API request";
      sendError(res, 401, "not_authenticated", AUTH_REQUIRED_MESSAGE);
      return;
    }
    const ok = await userHasAdministrator(db, userId);
    if (!ok) {
      res.locals.logMessage = "Administrator role required";
      sendError(res, 403, "not_administrator", NOT_ADMINISTRATOR_MESSAGE);
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
