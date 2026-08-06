import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { dispatchOpenSettings, sectionFromPath } from "../lib/settings";

/**
 * Deep-link / bookmark entry for settings. Opens the modal over the home screen
 * without leaving a Settings-only middle/main chrome behind.
 */
export function SettingsHubPage() {
  const { pathname } = useLocation();
  const section = sectionFromPath(pathname) ?? "appearance";

  useEffect(() => {
    dispatchOpenSettings(section);
  }, [section]);

  return <Navigate to="/" replace />;
}
