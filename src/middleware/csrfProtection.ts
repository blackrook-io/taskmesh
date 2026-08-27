import type { NextFunction, Request, Response } from "express";
import { sendError } from "../lib/httpError.js";
import { readSessionCookie } from "../lib/sessionCookie.js";

export const SPA_CLIENT_HEADER = "X-TaskMesh-Client";
export const SPA_CLIENT_VALUE = "ui";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Login establishes a session; cross-site login CSRF is low risk and must work without a prior cookie. */
function isCsrfExemptRoute(method: string, path: string): boolean {
  const normalized = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  return method === "POST" && normalized === "/auth/login";
}

function hasSpaClientHeader(req: Request): boolean {
  return req.get(SPA_CLIENT_HEADER)?.trim().toLowerCase() === SPA_CLIENT_VALUE;
}

/** When Origin/Referer is sent, require same host as the request (defense-in-depth with custom header). */
function isSameOriginRequest(req: Request): boolean {
  const host = req.get("host");
  if (!host) return true;

  const origin = req.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  const referer = req.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * CSRF protection for cookie-based sessions: mutating requests with a session
 * cookie require the SPA client header and same-origin Origin/Referer when present.
 * API keys (T0063) bypass this gate.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }

  if (isCsrfExemptRoute(req.method, req.path)) {
    next();
    return;
  }

  if (req.apiKeyId != null) {
    next();
    return;
  }

  const hasSession = req.sessionUserId != null || readSessionCookie(req) != null;
  if (!hasSession) {
    next();
    return;
  }

  if (!hasSpaClientHeader(req)) {
    res.locals.logMessage = "CSRF rejected: missing SPA client header";
    sendError(res, 403, "csrf_rejected", "Request rejected.");
    return;
  }

  if (!isSameOriginRequest(req)) {
    res.locals.logMessage = "CSRF rejected: cross-origin request";
    sendError(res, 403, "csrf_rejected", "Request rejected.");
    return;
  }

  next();
}
