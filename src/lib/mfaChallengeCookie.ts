import type { Request, Response } from "express";
import { useSecureCookies } from "./sessionCookie.js";

/** Matches MFA challenge TTL in services/mfa.ts (5 minutes). */
export const MFA_CHALLENGE_COOKIE_MAX_AGE_SECONDS = 5 * 60;

export const MFA_CHALLENGE_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "taskmesh_mfa_challenge"
    : "taskmesh_mfa_challenge_dev";

export function readMfaChallengeCookie(req: Request): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq);
    if (name !== MFA_CHALLENGE_COOKIE_NAME) continue;
    const value = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

export function setMfaChallengeCookie(
  res: Response,
  challengeId: string,
  maxAgeSeconds: number = MFA_CHALLENGE_COOKIE_MAX_AGE_SECONDS,
): void {
  const parts = [
    `${MFA_CHALLENGE_COOKIE_NAME}=${encodeURIComponent(challengeId)}`,
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

export function clearMfaChallengeCookie(res: Response): void {
  const parts = [
    `${MFA_CHALLENGE_COOKIE_NAME}=`,
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
