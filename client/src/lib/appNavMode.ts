/** Left app-nav density mode (desktop). Persisted in localStorage. */

export const APP_NAV_MODE_KEY = "taskmesh.appNav.mode";
export const APP_NAV_LAST_EXPANDED_KEY = "taskmesh.appNav.lastExpanded";
export const APP_NAV_LAST_PROJECT_KEY = "taskmesh.appNav.lastProjectId";

export const APP_NAV_MODES = ["full", "less", "hidden"] as const;
export type AppNavMode = (typeof APP_NAV_MODES)[number];

export type AppNavExpandedMode = "full" | "less";

export function isAppNavMode(value: string | null | undefined): value is AppNavMode {
  return value != null && (APP_NAV_MODES as readonly string[]).includes(value);
}

export function isAppNavExpandedMode(
  value: string | null | undefined,
): value is AppNavExpandedMode {
  return value === "full" || value === "less";
}

export function readStoredAppNavMode(): AppNavMode {
  try {
    const raw = localStorage.getItem(APP_NAV_MODE_KEY);
    if (isAppNavMode(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "full";
}

export function readStoredLastExpandedMode(): AppNavExpandedMode {
  try {
    const raw = localStorage.getItem(APP_NAV_LAST_EXPANDED_KEY);
    if (isAppNavExpandedMode(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "full";
}

export function persistAppNavMode(mode: AppNavMode): void {
  try {
    localStorage.setItem(APP_NAV_MODE_KEY, mode);
    if (mode !== "hidden") {
      localStorage.setItem(APP_NAV_LAST_EXPANDED_KEY, mode);
    }
  } catch {
    /* ignore */
  }
}

export function persistLastExpandedMode(mode: AppNavExpandedMode): void {
  try {
    localStorage.setItem(APP_NAV_LAST_EXPANDED_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function readStoredLastProjectId(): number | null {
  try {
    const raw = localStorage.getItem(APP_NAV_LAST_PROJECT_KEY);
    if (raw == null || raw === "") return null;
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function persistLastProjectId(projectId: number): void {
  try {
    localStorage.setItem(APP_NAV_LAST_PROJECT_KEY, String(projectId));
  } catch {
    /* ignore */
  }
}

export function lastProjectPath(): string {
  const id = readStoredLastProjectId();
  return id != null ? `/projects/${id}` : "/projects";
}
