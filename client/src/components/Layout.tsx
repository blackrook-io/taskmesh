import { Link, NavLink, Outlet } from "react-router-dom";

export function Layout() {
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
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
