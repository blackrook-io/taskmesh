import { useCallback, useEffect, useState } from "react";
import { matchPath, useLocation } from "react-router-dom";
import {
  type AppNavExpandedMode,
  type AppNavMode,
  persistAppNavMode,
  persistLastProjectId,
  readStoredAppNavMode,
  readStoredLastExpandedMode,
} from "./appNavMode";

/**
 * Desktop left-nav density + last-project tracking.
 * Mobile breakpoints ignore mode in CSS/shell (drawer always Full).
 */
export function useAppNavMode() {
  const [mode, setModeState] = useState<AppNavMode>(() =>
    typeof window !== "undefined" ? readStoredAppNavMode() : "full",
  );
  const [lastExpanded, setLastExpanded] = useState<AppNavExpandedMode>(() =>
    typeof window !== "undefined" ? readStoredLastExpandedMode() : "full",
  );
  const location = useLocation();

  const setMode = useCallback((next: AppNavMode) => {
    setModeState(next);
    persistAppNavMode(next);
    if (next !== "hidden") setLastExpanded(next);
  }, []);

  const collapse = useCallback(() => {
    setModeState((prev) => {
      if (prev === "full") {
        persistAppNavMode("less");
        setLastExpanded("less");
        return "less";
      }
      if (prev === "less") {
        persistAppNavMode("hidden");
        return "hidden";
      }
      return prev;
    });
  }, []);

  const expand = useCallback(() => {
    setModeState((prev) => {
      if (prev === "hidden") {
        const next = readStoredLastExpandedMode();
        persistAppNavMode(next);
        setLastExpanded(next);
        return next;
      }
      if (prev === "less") {
        persistAppNavMode("full");
        setLastExpanded("full");
        return "full";
      }
      return prev;
    });
  }, []);

  /** Hidden handle: restore last Full/Less. */
  const restoreFromHidden = useCallback(() => {
    setMode(lastExpanded);
  }, [lastExpanded, setMode]);

  useEffect(() => {
    const match = matchPath("/projects/:id", location.pathname);
    const raw = match?.params.id;
    if (!raw || raw === "new") return;
    const id = Number(raw);
    if (Number.isFinite(id) && id > 0) persistLastProjectId(id);
  }, [location.pathname]);

  return { mode, setMode, lastExpanded, collapse, expand, restoreFromHidden };
}
