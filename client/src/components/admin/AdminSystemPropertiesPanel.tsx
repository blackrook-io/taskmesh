import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiJson } from "../../api/client";
import { ThemeSwitcher } from "../shell/ThemeSwitcher";
import { isThemeId, type ThemeId } from "../../lib/theme";

type SystemProperties = {
  apiRateLimitPerMinute: number;
  loginFailureThreshold: number;
  sessionTimeoutMinutes?: number;
  defaultTheme: ThemeId;
  updatedAt: string | null;
};

function hasSessionTimeoutMinutes(
  data: SystemProperties | undefined,
): data is SystemProperties & { sessionTimeoutMinutes: number } {
  return typeof data?.sessionTimeoutMinutes === "number";
}

export function AdminSystemPropertiesPanel() {
  const qc = useQueryClient();
  const [rate, setRate] = useState("60");
  const [threshold, setThreshold] = useState("3");
  const [sessionTimeout, setSessionTimeout] = useState("60");
  const [defaultTheme, setDefaultTheme] = useState<ThemeId>("green");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const propsQuery = useQuery({
    queryKey: ["admin", "system-properties"],
    queryFn: async () => {
      const res = await apiJson<{ data: SystemProperties }>(
        "/api/v1/admin/system-properties",
      );
      return res.data;
    },
  });

  useEffect(() => {
    if (!propsQuery.data) return;
    setRate(String(propsQuery.data.apiRateLimitPerMinute));
    setThreshold(String(propsQuery.data.loginFailureThreshold));
    if (hasSessionTimeoutMinutes(propsQuery.data)) {
      setSessionTimeout(String(propsQuery.data.sessionTimeoutMinutes));
    }
    if (isThemeId(propsQuery.data.defaultTheme)) {
      setDefaultTheme(propsQuery.data.defaultTheme);
    }
  }, [propsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const apiRateLimitPerMinute = Number(rate);
      const loginFailureThreshold = Number(threshold);
      const supportsSessionTimeout = hasSessionTimeoutMinutes(propsQuery.data);
      const sessionTimeoutMinutes = Number(sessionTimeout);
      if (!Number.isInteger(apiRateLimitPerMinute) || apiRateLimitPerMinute < 1) {
        throw new Error("API rate limit must be a positive integer");
      }
      if (!Number.isInteger(loginFailureThreshold) || loginFailureThreshold < 1) {
        throw new Error("Login failure threshold must be a positive integer");
      }
      if (
        supportsSessionTimeout &&
        (!Number.isInteger(sessionTimeoutMinutes) || sessionTimeoutMinutes < 1)
      ) {
        throw new Error("Session timeout must be a positive integer (minutes)");
      }
      if (!isThemeId(defaultTheme)) {
        throw new Error("Default theme is invalid");
      }
      const body: {
        apiRateLimitPerMinute: number;
        loginFailureThreshold: number;
        defaultTheme: ThemeId;
        sessionTimeoutMinutes?: number;
      } = {
        apiRateLimitPerMinute,
        loginFailureThreshold,
        defaultTheme,
      };
      if (supportsSessionTimeout) {
        body.sessionTimeoutMinutes = sessionTimeoutMinutes;
      }
      const res = await apiJson<{ data: SystemProperties }>(
        "/api/v1/admin/system-properties",
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      );
      return res.data;
    },
    onSuccess: async () => {
      setError(null);
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ["admin", "system-properties"] });
      window.setTimeout(() => setSaved(false), 2000);
    },
    onError: (err: Error) => setError(err.message),
  });

  const supportsSessionTimeout = hasSessionTimeoutMinutes(propsQuery.data);

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        System-level defaults and thresholds. The default theme applies until a user sets a
        personal preference on their device. Login failure threshold is enforced at sign-in
        {supportsSessionTimeout
          ? ". Session timeout is stored for future middleware; changing it does not affect existing sessions until enforcement ships."
          : "."}
      </p>

      {propsQuery.isLoading ? <p className="muted">Loading…</p> : null}

      <ThemeSwitcher
        label="Default theme"
        aria-label="System default theme"
        value={defaultTheme}
        onChange={setDefaultTheme}
      />
      <p className="muted small" style={{ marginTop: 0 }}>
        Used when a browser has no personal theme saved. Changing this does not override existing
        personal preferences.
      </p>

      <label className="field">
        <span>API rate limit (requests per minute, per key)</span>
        <input
          type="number"
          min={1}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Login failure threshold (locks account after failed sign-in attempts)</span>
        <input
          type="number"
          min={1}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />
      </label>

      {supportsSessionTimeout ? (
        <>
          <label className="field">
            <span>Session timeout (minutes)</span>
            <input
              type="number"
              min={1}
              value={sessionTimeout}
              onChange={(e) => setSessionTimeout(e.target.value)}
            />
          </label>
          <p className="muted small" style={{ marginTop: 0 }}>
            Stored for browser session cookie lifetime and future server enforcement. Idle timeout
            middleware is not active yet.
          </p>
        </>
      ) : null}

      {propsQuery.data?.updatedAt ? (
        <p className="muted small">
          Last saved: {new Date(propsQuery.data.updatedAt).toLocaleString()}
        </p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {saved ? <p className="ok-text">Saved.</p> : null}

      <button
        type="button"
        className="btn primary small"
        disabled={saveMutation.isPending}
        onClick={() => saveMutation.mutate()}
      >
        Save
      </button>
    </div>
  );
}
