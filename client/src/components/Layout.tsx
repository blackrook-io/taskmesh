import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";

export function Layout() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/" className="brand">
          TaskMesh
        </Link>
        <nav className="nav">
          <NavLink to="/ideas" className={({ isActive }) => (isActive ? "active" : "")}>
            Ideas
          </NavLink>
          <NavLink to="/projects" className={({ isActive }) => (isActive ? "active" : "")}>
            Projects
          </NavLink>
          <NavLink to="/todos" className={({ isActive }) => (isActive ? "active" : "")}>
            To Dos
          </NavLink>
          <NavLink to="/search" className={({ isActive }) => (isActive ? "active" : "")}>
            Search
          </NavLink>
          <button
            type="button"
            className="btn ghost small command-palette-trigger"
            onClick={() => setPaletteOpen(true)}
            title="Command palette (Ctrl/⌘K)"
            aria-keyshortcuts="Control+K Meta+K"
          >
            ⌘K
          </button>
          <NavLink to="/dev/playground" className={({ isActive }) => (isActive ? "active" : "")}>
            Playground
          </NavLink>
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
