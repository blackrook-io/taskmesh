export const THEME_STORAGE_KEY = "taskmesh.theme";

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
