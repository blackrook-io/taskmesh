import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import type { AppNavMode } from "../../lib/appNavMode";
import { useAppNavMode } from "../../lib/useAppNavMode";
import { AppNav } from "./AppNav";

const MOBILE_NAV_MQ = "(max-width: 960px)";

type Props = {
  onOpenPalette: () => void;
  onOpenAssistant: () => void;
};

function useIsMobileNav(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_NAV_MQ).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_NAV_MQ);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

export function AppShell({ onOpenPalette, onOpenAssistant }: Props) {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const { mode, collapse, expand, restoreFromHidden } = useAppNavMode();
  const isMobileNav = useIsMobileNav();
  const desktopMode: AppNavMode = isMobileNav ? "full" : mode;

  const closeDrawer = () => setNavOpen(false);

  const locationKey = `${location.pathname}${location.search}`;
  const [prevLocationKey, setPrevLocationKey] = useState(locationKey);
  if (prevLocationKey !== locationKey) {
    setPrevLocationKey(locationKey);
    setNavOpen(false);
  }

  const shellClass = [
    "app-shell",
    `app-shell--nav-${desktopMode}`,
    navOpen ? "app-shell--nav-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      <header className="app-shell__mobile-bar">
        <button
          type="button"
          className="btn ghost small"
          aria-expanded={navOpen}
          aria-controls="app-nav-drawer"
          onClick={() => setNavOpen((o) => !o)}
        >
          Menu
        </button>
      </header>

      {navOpen ? (
        <button
          type="button"
          className="app-shell__backdrop"
          aria-label="Close navigation"
          onClick={closeDrawer}
        />
      ) : null}

      {!isMobileNav && mode === "hidden" ? (
        <button
          type="button"
          className="app-shell__nav-handle"
          aria-label="Show navigation"
          title="Show navigation"
          onClick={restoreFromHidden}
        >
          <span className="app-shell__nav-handle-bar" aria-hidden />
          <span className="app-shell__nav-handle-chevron" aria-hidden>
            ›
          </span>
        </button>
      ) : null}

      <div id="app-nav-drawer" className="app-shell__nav">
        <AppNav
          mode={desktopMode}
          onCollapse={collapse}
          onExpand={expand}
          onOpenPalette={onOpenPalette}
          onOpenAssistant={onOpenAssistant}
          onNavigate={closeDrawer}
        />
      </div>
      <main className="app-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
