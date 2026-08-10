import { createContext, useContext } from "react";
import type { ThemeId } from "./theme";

export type ThemeContextValue = {
  /** Currently applied theme (document `data-theme`). */
  theme: ThemeId;
  /** @deprecated Prefer `setPlatformTheme` — kept as alias for platform preference. */
  setTheme: (theme: ThemeId) => void;
  platformTheme: ThemeId;
  setPlatformTheme: (theme: ThemeId) => void;
  /** System-wide default when no personal `taskmesh.theme` is set. */
  systemDefaultTheme: ThemeId;
  separateProjectThemes: boolean;
  setSeparateProjectThemes: (enabled: boolean) => void;
  getProjectTheme: (projectId: number) => ThemeId | null;
  setProjectTheme: (projectId: number, theme: ThemeId | null) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
