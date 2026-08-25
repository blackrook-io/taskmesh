import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { apiJson } from "../api/client";
import {
  applyInstanceFavicon,
  isViteDevInstance,
  resolveSystemDefaultFromConfig,
  viteDevSystemDefault,
} from "./instanceBrand";
import {
  applyTheme,
  getProjectThemeFromMap,
  persistProjectThemes,
  persistSeparateProjectThemes,
  persistStickyProjectTheme,
  readPersonalTheme,
  readProjectThemes,
  readSeparateProjectThemes,
  readStickyProjectTheme,
  resolveAppliedTheme,
  resolvePlatformTheme,
  THEME_STORAGE_KEY,
  type ProjectThemesMap,
  type StickyProjectTheme,
  type ThemeId,
} from "./theme";
import { ThemeContext } from "./themeContext";

function useRouteProjectId(): number | null {
  const { pathname } = useLocation();
  const match = matchPath("/projects/:id", pathname);
  if (!match?.params.id || match.params.id === "new") return null;
  const id = Number(match.params.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const routeProjectId = useRouteProjectId();

  const [systemDefaultTheme, setSystemDefaultTheme] = useState<ThemeId>(viteDevSystemDefault);

  const [platformTheme, setPlatformThemeState] = useState<ThemeId>(() => {
    if (typeof document === "undefined") return viteDevSystemDefault();
    return resolvePlatformTheme(readPersonalTheme(), viteDevSystemDefault());
  });

  const [separateProjectThemes, setSeparateState] = useState(() => {
    if (typeof document === "undefined") return false;
    return readSeparateProjectThemes();
  });

  const [projectThemes, setProjectThemesState] = useState<ProjectThemesMap>(() => {
    if (typeof document === "undefined") return {};
    return readProjectThemes();
  });

  const [sticky, setStickyState] = useState<StickyProjectTheme | null>(() => {
    if (typeof document === "undefined") return null;
    if (!readSeparateProjectThemes()) return null;
    return readStickyProjectTheme();
  });

  const [theme, setThemeState] = useState<ThemeId>(() => {
    if (typeof document === "undefined") return viteDevSystemDefault();
    const platform = resolvePlatformTheme(readPersonalTheme(), viteDevSystemDefault());
    const separate = readSeparateProjectThemes();
    const stickyVal = separate ? readStickyProjectTheme() : null;
    const applied = resolveAppliedTheme(separate, stickyVal, platform);
    applyTheme(applied);
    return applied;
  });

  const setApplied = useCallback((next: ThemeId) => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  const setSticky = useCallback((next: StickyProjectTheme | null) => {
    persistStickyProjectTheme(next);
    setStickyState(next);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (isViteDevInstance()) applyInstanceFavicon("dev");
  }, []);

  // Load system default when no personal preference is stored.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiJson<{
          data: { defaultTheme: string; instance?: string; instanceTheme?: string | null };
        }>("/api/v1/config");
        const next = resolveSystemDefaultFromConfig(res.data);
        if (cancelled) return;
        if (res.data.instance === "dev" || res.data.instance === "prod") {
          applyInstanceFavicon(res.data.instance);
        }
        setSystemDefaultTheme(next);
        if (readPersonalTheme() != null) return;
        const platform = resolvePlatformTheme(null, next);
        setPlatformThemeState(platform);
        const separate = readSeparateProjectThemes();
        const stickyVal = separate ? readStickyProjectTheme() : null;
        setApplied(resolveAppliedTheme(separate, stickyVal, platform));
      } catch {
        /* keep Vite/PROD hardcoded fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setApplied]);

  // Sticky apply when entering a project that has an explicit override.
  useEffect(() => {
    if (!separateProjectThemes || routeProjectId == null) return;
    const override = getProjectThemeFromMap(projectThemes, routeProjectId);
    if (override == null) return;
    if (sticky?.projectId === routeProjectId && sticky.theme === override) {
      if (theme !== override) setApplied(override);
      return;
    }
    setSticky({ projectId: routeProjectId, theme: override });
    setApplied(override);
  }, [
    separateProjectThemes,
    routeProjectId,
    projectThemes,
    sticky?.projectId,
    sticky?.theme,
    theme,
    setApplied,
    setSticky,
  ]);

  const setPlatformTheme = useCallback(
    (next: ThemeId) => {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      setPlatformThemeState(next);
      if (!separateProjectThemes || sticky == null) {
        setApplied(next);
      }
    },
    [separateProjectThemes, sticky, setApplied],
  );

  const setTheme = setPlatformTheme;

  const setSeparateProjectThemes = useCallback(
    (enabled: boolean) => {
      persistSeparateProjectThemes(enabled);
      setSeparateState(enabled);
      if (!enabled) {
        setSticky(null);
        setApplied(platformTheme);
      }
    },
    [platformTheme, setApplied, setSticky],
  );

  const getProjectTheme = useCallback(
    (projectId: number) => getProjectThemeFromMap(projectThemes, projectId),
    [projectThemes],
  );

  const setProjectTheme = useCallback(
    (projectId: number, next: ThemeId | null) => {
      const effective = next == null || next === platformTheme ? null : next;

      setProjectThemesState((prev) => {
        const key = String(projectId);
        const map = { ...prev };
        if (effective == null) {
          delete map[key];
        } else {
          map[key] = effective;
        }
        persistProjectThemes(map);
        return map;
      });

      const onPage = routeProjectId === projectId;
      const isStickySource = sticky?.projectId === projectId;
      if (separateProjectThemes && (onPage || isStickySource)) {
        if (effective == null) {
          setSticky(null);
          setApplied(platformTheme);
        } else {
          setSticky({ projectId, theme: effective });
          setApplied(effective);
        }
      }
    },
    [
      platformTheme,
      routeProjectId,
      sticky?.projectId,
      separateProjectThemes,
      setSticky,
      setApplied,
    ],
  );

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      platformTheme,
      setPlatformTheme,
      systemDefaultTheme,
      separateProjectThemes,
      setSeparateProjectThemes,
      getProjectTheme,
      setProjectTheme,
    }),
    [
      theme,
      setTheme,
      platformTheme,
      setPlatformTheme,
      systemDefaultTheme,
      separateProjectThemes,
      setSeparateProjectThemes,
      getProjectTheme,
      setProjectTheme,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
