export const BLOCKED_NOTICE_DISMISS_KEY = "taskmesh.blocked-state-notice.dismissed";
export const BLOCKED_NOTICE_EVENT = "taskmesh:blocked-state-notice";

export function blockedNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(BLOCKED_NOTICE_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissBlockedNotice(): void {
  try {
    localStorage.setItem(BLOCKED_NOTICE_DISMISS_KEY, "1");
  } catch {
    /* private browsing */
  }
}

/** Tell the shell to explain a Ready request that the server stored as Blocked. */
export function maybeNotifyBlockedReady(requested: unknown, savedState: string): void {
  if (requested !== "ready" || savedState !== "blocked") return;
  if (blockedNoticeDismissed()) return;
  window.dispatchEvent(new CustomEvent(BLOCKED_NOTICE_EVENT));
}
