import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { setSessionExpiredNavigator } from "../api/sessionExpired";

/** Registers SPA navigation for a dead session. Must render inside the router. */
export function SessionExpiryBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    setSessionExpiredNavigator((url) => {
      navigate(url, { replace: true });
    });
    return () => setSessionExpiredNavigator(null);
  }, [navigate]);
  return null;
}
