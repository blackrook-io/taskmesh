import type { NextFunction, Request, Response } from "express";
import { AUTH_REQUIRED_MESSAGE } from "../lib/authErrors.js";
import { sendError } from "../lib/httpError.js";

/** Public v1 routes (relative to `/api/v1` mount). */
export function isPublicV1Route(method: string, path: string): boolean {
  const normalized = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  if (method === "POST" && normalized === "/auth/login") return true;
  if (method === "POST" && normalized === "/auth/logout") return true;
  if (method === "GET" && normalized === "/auth/session") return true;
  if (method === "GET" && (normalized === "/config" || normalized.startsWith("/config/"))) {
    return true;
  }
  return false;
}

/**
 * Require a valid browser session (or future API key — T0063) on protected routes.
 * Runs after sessionLoader; public auth/config endpoints bypass this gate.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isPublicV1Route(req.method, req.path)) {
    next();
    return;
  }

  // T0063 will validate API keys and set req.apiKeyId before this middleware runs.
  if (req.apiKeyId != null) {
    next();
    return;
  }

  if (req.sessionUserId == null) {
    res.locals.logMessage = "Unauthenticated API request";
    sendError(res, 401, "not_authenticated", AUTH_REQUIRED_MESSAGE);
    return;
  }

  next();
}
