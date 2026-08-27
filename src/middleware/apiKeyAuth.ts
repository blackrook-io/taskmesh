import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client.js";
import { sendError } from "../lib/httpError.js";
import { resolveApiKeyForAuth, touchApiKeyUsage } from "../services/apiKeys.js";
import { userHasAdministrator } from "../services/roles.js";

const QUERY_KEY_PARAMS = ["api_key", "apiKey", "apikey", "access_token"] as const;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hasBannedKeyQuery(req: Request): boolean {
  const q = req.query;
  for (const name of QUERY_KEY_PARAMS) {
    const v = q[name];
    if (v == null) continue;
    if (Array.isArray(v) ? v.some((x) => String(x).length > 0) : String(v).length > 0) {
      return true;
    }
  }
  return false;
}

/** Extract presented key from Authorization Bearer and/or X-API-Key. */
export function extractPresentedApiKey(req: Request): {
  rawKey: string | null;
  conflict: boolean;
} {
  const auth = req.get("authorization");
  let bearer: string | undefined;
  if (auth) {
    const m = /^Bearer\s+(\S+)/i.exec(auth.trim());
    if (m) bearer = m[1];
  }
  const headerKey = req.get("x-api-key")?.trim();
  if (bearer && headerKey && bearer !== headerKey) {
    return { rawKey: null, conflict: true };
  }
  return { rawKey: bearer || headerKey || null, conflict: false };
}

function serviceError(
  res: Response,
  err: unknown,
): boolean {
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

/**
 * Validate API key headers (T0063). Sets `req.apiKeyId` / `req.apiKeyUserId` and
 * logging locals. Ban keys in query strings. Enforce RO/RW on methods.
 */
export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (hasBannedKeyQuery(req)) {
      res.locals.logMessage = "API key presented in query string";
      sendError(
        res,
        400,
        "api_key_in_query",
        "API keys must not be passed in the URL query string. Use Authorization: Bearer or X-API-Key.",
      );
      return;
    }

    const { rawKey, conflict } = extractPresentedApiKey(req);
    if (conflict) {
      res.locals.logMessage = "Conflicting API key headers";
      sendError(res, 401, "invalid_api_key", "Conflicting Authorization and X-API-Key values.");
      return;
    }
    if (!rawKey) {
      next();
      return;
    }

    const resolved = await resolveApiKeyForAuth(db, rawKey);
    const ownerIsAdmin = await userHasAdministrator(db, resolved.userId);
    const adminTag = ownerIsAdmin ? " [ADMIN KEY]" : "";

    if (resolved.access === "readonly" && !SAFE_METHODS.has(req.method.toUpperCase())) {
      res.locals.logUserId = resolved.userId;
      res.locals.logApiKeyId = resolved.keyId;
      res.locals.logAdminKey = ownerIsAdmin;
      res.locals.logMessage = `Read-only API key denied write${adminTag}`;
      sendError(
        res,
        403,
        "access_violation",
        "This API key is read-only and cannot perform write operations.",
      );
      return;
    }

    req.apiKeyId = resolved.keyId;
    req.apiKeyUserId = resolved.userId;
    res.locals.logUserId = resolved.userId;
    res.locals.logApiKeyId = resolved.keyId;
    res.locals.logAdminKey = ownerIsAdmin;

    void touchApiKeyUsage(db, resolved.keyId, resolved.userId).catch((err) => {
      console.error("api key last_used update failed", err);
    });

    next();
  } catch (err) {
    if (serviceError(res, err)) {
      const e = err as { code?: string; message?: string };
      res.locals.logMessage =
        e.code === "key_suspended"
          ? "Suspended API key rejected"
          : `API key auth failed`;
      return;
    }
    next(err);
  }
}
