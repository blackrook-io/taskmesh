import type { Request, Response } from "express";
import { useSecureCookies } from "./sessionCookie.js";

/**
 * PROD / DEV cookie name split mirrors session cookies so Secure PROD cookies
 * do not block HTTP DEV Set-Cookie on the same host.
 */
export const MFA_TRUST_COOKIE_NAME =
  process.env.NODE_ENV === "production" ? "taskmesh_mfa_trust" : "taskmesh_mfa_trust_dev";

export function readMfaTrustCookie(req: Request): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq);
    if (name !== MFA_TRUST_COOKIE_NAME) continue;
    const value = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

export function setMfaTrustCookie(
  res: Response,
  token: string,
  maxAgeSeconds: number,
): void {
  const parts = [
    `${MFA_TRUST_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (maxAgeSeconds > 0) {
    parts.push(`Max-Age=${Math.floor(maxAgeSeconds)}`);
  }
  if (useSecureCookies()) {
    parts.push("Secure");
  }
  res.append("Set-Cookie", parts.join("; "));
}

export function clearMfaTrustCookie(res: Response): void {
  const parts = [
    `${MFA_TRUST_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (useSecureCookies()) {
    parts.push("Secure");
  }
  res.append("Set-Cookie", parts.join("; "));
}
