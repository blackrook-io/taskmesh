/** Shared session-loss redirect for SPA API 401s (T0134). */

type SessionExpiredHandler = () => void;

let handler: SessionExpiredHandler | null = null;
let handling = false;
/** Sticky until LoginPage clears — safe under StrictMode double-render. */
let pendingReason = false;

export function setSessionExpiredHandler(fn: SessionExpiredHandler | null): void {
  handler = fn;
}

/** Read without clearing (AuthGate may render more than once). */
export function peekSessionExpiredReason(): boolean {
  return pendingReason;
}

/** Allow a later session loss after the user has reached login / signed in again. */
export function resetSessionExpiredGuard(): void {
  handling = false;
  pendingReason = false;
}

/**
 * Skip credential failures on the login endpoint — those are not session expiry.
 */
export function isLoginCredentialRequest(path: string): boolean {
  const bare = path.split("?")[0] ?? path;
  return bare === "/api/v1/auth/login" || bare.endsWith("/auth/login");
}

export function notifySessionExpired(): void {
  if (handling) return;
  handling = true;
  pendingReason = true;
  try {
    handler?.();
  } catch {
    // AuthGate still picks up pendingReason if the clear partially failed.
  }
}
