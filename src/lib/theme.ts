/** Accent theme ids — keep in sync with `client/src/lib/theme.ts`. */
export const THEME_IDS = ["green", "blue", "orange", "yellow", "purple", "red"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = "green";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}
