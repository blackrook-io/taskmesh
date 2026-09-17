import { Navigate, Outlet, useLocation } from "react-router-dom";
import { peekSessionExpiredReason } from "../api/sessionExpired";
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
    const params = new URLSearchParams();
    if (returnTo && returnTo !== "/") {
      params.set("returnTo", returnTo);
    }
    if (peekSessionExpiredReason()) {
      params.set("reason", "session");
    }
    const search = params.toString();
    return <Navigate to={search ? `/login?${search}` : "/login"} replace />;
  }

  return <Outlet />;
}
