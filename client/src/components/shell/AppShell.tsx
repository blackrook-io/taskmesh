import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppNav } from "./AppNav";
import { ContextNav } from "./ContextNav";

type Props = {
  onOpenPalette: () => void;
  onOpenAssistant: () => void;
};

export function AppShell({ onOpenPalette, onOpenAssistant }: Props) {
  const [navOpen, setNavOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const location = useLocation();

  const closeDrawers = () => {
    setNavOpen(false);
    setContextOpen(false);
  };

  useEffect(() => {
    closeDrawers();
  }, [location.pathname, location.search]);

  return (
    <div className={`app-shell${navOpen ? " app-shell--nav-open" : ""}${contextOpen ? " app-shell--context-open" : ""}`}>
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

      <div id="app-nav-drawer" className="app-shell__nav">
        <AppNav
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
