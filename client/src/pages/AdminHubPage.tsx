import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { adminSectionFromPath, dispatchOpenAdmin } from "../lib/administration";
import { useAuth } from "../lib/auth";
import { userIsAdministrator } from "../lib/roles";
import { dispatchOpenSettings } from "../lib/settings";

/**
 * Deep-link entry for Administration (and legacy /settings/backups → admin).
 */
export function AdminHubPage() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const allowed = userIsAdministrator(user);

  useEffect(() => {
    if (!allowed) return;
    if (pathname === "/settings/backups") {
      dispatchOpenAdmin("backups");
      return;
    }
    const section = adminSectionFromPath(pathname) ?? "users";
    dispatchOpenAdmin(section);
  }, [pathname, allowed]);

  return <Navigate to="/" replace />;
}

/** Kept for SettingsHubPage redirect of removed backups section. */
export function redirectLegacyBackupsSettings(): void {
  dispatchOpenSettings("appearance");
  dispatchOpenAdmin("backups");
}
