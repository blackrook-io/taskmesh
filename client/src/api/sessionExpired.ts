/** Shared session-loss redirect for SPA API 401s (T0134, T0382). */

type SessionExpiredHandler = () => void;
type NavigateToLogin = (url: string) => void;

export type SessionLossLocation = {
  pathname: string;
  search: string;
  hash: string;
};

let handler: SessionExpiredHandler | null = null;
let navigateToLogin: NavigateToLogin | null = null;
let handling = false;
/** Sticky until LoginPage clears the latch — safe under StrictMode double-render. */
let pendingReason = false;
/** Synchronous logged-out flag so a stale loginUser cannot keep the shell mounted. */
let forcedLoggedOut = false;
/** Profile log out and similar explicit sign-outs must not look like expiry. */
let explicitLogout = false;

export function setSessionExpiredHandler(fn: SessionExpiredHandler | null): void {
  handler = fn;
}

export function setSessionExpiredNavigator(fn: NavigateToLogin | null): void {
  navigateToLogin = fn;
}

/** Read without clearing (AuthGate may render more than once). */
export function peekSessionExpiredReason(): boolean {
  return pendingReason;
}

export function isForcedLoggedOut(): boolean {
  return forcedLoggedOut;
}

/**
 * Login page mounted after a session-loss redirect. Clears the one-shot latch so a later
 * expiry can redirect again. An explicit sign-out keeps its suppression until the next sign-in.
 */
export function resetSessionExpiredGuard(): void {
  if (explicitLogout) return;
  handling = false;
  pendingReason = false;
}

/** Successful sign-in: the in-memory user is trustworthy again. */
export function markSessionActive(): void {
  forcedLoggedOut = false;
  handling = false;
  pendingReason = false;
  explicitLogout = false;
}

/** Call before destroying the session on an intentional sign-out. */
export function beginExplicitLogout(): void {
  explicitLogout = true;
  pendingReason = false;
  // Latch until the next successful sign-in so in-flight 401s cannot rewrite /login.
  handling = true;
}

/**
 * Skip credential failures on the login endpoint — those are not session expiry.
 */
export function isLoginCredentialRequest(path: string): boolean {
  const bare = path.split("?")[0] ?? path;
  return (
    bare === "/api/v1/auth/login" ||
    bare.endsWith("/auth/login") ||
    bare === "/api/v1/auth/mfa/verify" ||
    bare.endsWith("/auth/mfa/verify")
  );
}

export function sessionLossLoginUrl(loc: SessionLossLocation): string {
  const returnTo = `${loc.pathname}${loc.search}${loc.hash}`;
  const params = new URLSearchParams();
  if (returnTo && returnTo !== "/" && !returnTo.startsWith("/login")) {
    params.set("returnTo", returnTo);
  }
  params.set("reason", "session");
  return `/login?${params.toString()}`;
}

/**
 * Decide and record a session-loss redirect. Returns the login URL, or null when
 * this 401 must not leave the page (already handling, already on login, or an explicit logout).
 */
export function redirectForSessionLoss(loc: SessionLossLocation): string | null {
  if (explicitLogout || handling) return null;
  if (loc.pathname === "/login") return null;
  handling = true;
  pendingReason = true;
  forcedLoggedOut = true;
  try {
    handler?.();
  } catch {
    // Still leave the page if clearing auth state threw.
  }
  return sessionLossLoginUrl(loc);
}

function currentLocation(): SessionLossLocation {
  if (typeof window === "undefined") {
    return { pathname: "/", search: "", hash: "" };
  }
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
}

export function notifySessionExpired(): void {
  const url = redirectForSessionLoss(currentLocation());
  if (!url) return;
  try {
    if (navigateToLogin) navigateToLogin(url);
    else if (typeof window !== "undefined") window.location.replace(url);
  } catch {
    if (typeof window !== "undefined") window.location.replace(url);
  }
}
