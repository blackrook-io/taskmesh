import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { adminSectionFromPath, dispatchOpenAdmin } from "../lib/administration";
import { dispatchOpenSettings } from "../lib/settings";

/**
 * Deep-link entry for Administration (and legacy /settings/backups → admin).
 */
export function AdminHubPage() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname === "/settings/backups") {
      dispatchOpenAdmin("backups");
      return;
    }
    const section = adminSectionFromPath(pathname) ?? "users";
    dispatchOpenAdmin(section);
  }, [pathname]);

  return <Navigate to="/" replace />;
}

/** Kept for SettingsHubPage redirect of removed backups section. */
export function redirectLegacyBackupsSettings(): void {
  dispatchOpenSettings("appearance");
  dispatchOpenAdmin("backups");
}
