import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function AuthGate() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-gate-loading" role="status" aria-live="polite">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    const search =
      returnTo && returnTo !== "/"
        ? `?returnTo=${encodeURIComponent(returnTo)}`
        : "";
    return <Navigate to={`/login${search}`} replace />;
  }

  return <Outlet />;
}
