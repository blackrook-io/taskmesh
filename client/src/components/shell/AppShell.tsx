import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import type { AppNavMode } from "../../lib/appNavMode";
import { useAppNavMode } from "../../lib/useAppNavMode";
import { AppNav } from "./AppNav";
import { ContextNav } from "./ContextNav";

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
  const [contextOpen, setContextOpen] = useState(false);
  const location = useLocation();
  const { mode, collapse, expand, restoreFromHidden } = useAppNavMode();
  const isMobileNav = useIsMobileNav();
  const desktopMode: AppNavMode = isMobileNav ? "full" : mode;

  const closeDrawers = () => {
    setNavOpen(false);
    setContextOpen(false);
  };

  useEffect(() => {
    closeDrawers();
  }, [location.pathname, location.search]);

  const shellClass = [
    "app-shell",
    `app-shell--nav-${desktopMode}`,
    navOpen ? "app-shell--nav-open" : "",
    contextOpen ? "app-shell--context-open" : "",
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
          onClick={() => {
            setNavOpen((o) => !o);
            setContextOpen(false);
          }}
        >
          Menu
        </button>
        <button
          type="button"
          className="btn ghost small"
          aria-expanded={contextOpen}
          aria-controls="context-nav-drawer"
          onClick={() => {
            setContextOpen((o) => !o);
            setNavOpen(false);
          }}
        >
          Section
        </button>
      </header>

      {(navOpen || contextOpen) && (
        <button
          type="button"
          className="app-shell__backdrop"
          aria-label="Close navigation"
          onClick={closeDrawers}
        />
      )}

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
          onNavigate={closeDrawers}
        />
      </div>
      <div id="context-nav-drawer" className="app-shell__context">
        <ContextNav />
      </div>
      <main className="app-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
