export const THEME_STORAGE_KEY = "taskmesh.theme";
export const SEPARATE_PROJECT_THEMES_KEY = "taskmesh.separateProjectThemes";
export const PROJECT_THEMES_KEY = "taskmesh.projectThemes";
export const STICKY_PROJECT_THEME_KEY = "taskmesh.stickyProjectTheme";

export const THEME_IDS = ["green", "blue", "orange", "yellow", "purple", "red"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_LABELS: Record<ThemeId, string> = {
  green: "Green",
  blue: "Blue",
  orange: "Orange",
  yellow: "Yellow",
  purple: "Purple",
  red: "Red",
};

/** Swatch colors for the picker (match theme accents). */
export const THEME_SWATCHES: Record<ThemeId, string> = {
  green: "#7dd87d",
  blue: "#6eb5ff",
  orange: "#f0a060",
  yellow: "#e8c84a",
  purple: "#b794f6",
  red: "#f07178",
};

export const DEFAULT_THEME: ThemeId = "green";

export type ProjectThemesMap = Record<string, ThemeId>;

export type StickyProjectTheme = {
  projectId: number;
  theme: ThemeId;
};

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return value != null && (THEME_IDS as readonly string[]).includes(value);
}

export function readStoredTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
}

export function persistTheme(theme: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme);
}

export function readSeparateProjectThemes(): boolean {
  try {
    return localStorage.getItem(SEPARATE_PROJECT_THEMES_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistSeparateProjectThemes(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(SEPARATE_PROJECT_THEMES_KEY, "1");
    } else {
      localStorage.setItem(SEPARATE_PROJECT_THEMES_KEY, "0");
    }
  } catch {
    /* ignore */
  }
}

export function readProjectThemes(): ProjectThemesMap {
  try {
    const raw = localStorage.getItem(PROJECT_THEMES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ProjectThemesMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isThemeId(typeof value === "string" ? value : null)) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function persistProjectThemes(map: ProjectThemesMap): void {
  try {
    localStorage.setItem(PROJECT_THEMES_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function getProjectThemeFromMap(
  map: ProjectThemesMap,
  projectId: number,
): ThemeId | null {
  const value = map[String(projectId)];
  return isThemeId(value) ? value : null;
}

export function readStickyProjectTheme(): StickyProjectTheme | null {
  try {
    const raw = localStorage.getItem(STICKY_PROJECT_THEME_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const projectId = Number(obj.projectId);
    const theme = obj.theme;
    if (!Number.isFinite(projectId) || projectId <= 0 || !isThemeId(typeof theme === "string" ? theme : null)) {
      return null;
    }
    return { projectId, theme };
  } catch {
    return null;
  }
}

export function persistStickyProjectTheme(sticky: StickyProjectTheme | null): void {
  try {
    if (sticky == null) {
      localStorage.removeItem(STICKY_PROJECT_THEME_KEY);
    } else {
      localStorage.setItem(STICKY_PROJECT_THEME_KEY, JSON.stringify(sticky));
    }
  } catch {
    /* ignore */
  }
}

export function resolveAppliedTheme(
  separate: boolean,
  sticky: StickyProjectTheme | null,
  platformTheme: ThemeId,
): ThemeId {
  if (separate && sticky != null) return sticky.theme;
  return platformTheme;
}
