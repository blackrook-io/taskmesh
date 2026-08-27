import type { Request, Response } from "express";

/**
 * PROD uses `taskmesh_session` (Secure). DEV uses a distinct name so a Secure
 * PROD cookie on the same host (127.0.0.1 / localhost / LAN IP) cannot block
 * the non-Secure DEV Set-Cookie — browsers refuse to overwrite Secure cookies
 * from an HTTP origin.
 */
export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production" ? "taskmesh_session" : "taskmesh_session_dev";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function readSessionCookie(req: Request): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq);
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

export function setSessionCookie(
  res: Response,
  sessionId: string,
  maxAgeSeconds: number,
): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (maxAgeSeconds > 0) {
    parts.push(`Max-Age=${Math.floor(maxAgeSeconds)}`);
  }
  if (isProduction()) {
    parts.push("Secure");
  }
  res.append("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: Response): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isProduction()) {
    parts.push("Secure");
  }
  res.append("Set-Cookie", parts.join("; "));
}
