import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";
import { ThemeSwitcher } from "../shell/ThemeSwitcher";
import { isThemeId, type ThemeId } from "../../lib/theme";

type MfaEnforcement = "none" | "administrators";

type SystemProperties = {
  apiRateLimitPerMinute: number;
  loginFailureThreshold: number;
  sessionTimeoutMinutes?: number;
  defaultTheme: ThemeId;
  mfaEnforcement?: MfaEnforcement;
  mfaGraceDays?: number;
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
  const [mfaEnforcement, setMfaEnforcement] = useState<MfaEnforcement>("none");
  const [mfaGraceDays, setMfaGraceDays] = useState("7");
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

  const [prevData, setPrevData] = useState(propsQuery.data);
  if (propsQuery.data !== prevData) {
    setPrevData(propsQuery.data);
    if (propsQuery.data) {
      setRate(String(propsQuery.data.apiRateLimitPerMinute));
      setThreshold(String(propsQuery.data.loginFailureThreshold));
      if (hasSessionTimeoutMinutes(propsQuery.data)) {
        setSessionTimeout(String(propsQuery.data.sessionTimeoutMinutes));
      }
      if (isThemeId(propsQuery.data.defaultTheme)) {
        setDefaultTheme(propsQuery.data.defaultTheme);
      }
      if (
        propsQuery.data.mfaEnforcement === "none" ||
        propsQuery.data.mfaEnforcement === "administrators"
      ) {
        setMfaEnforcement(propsQuery.data.mfaEnforcement);
      }
      if (typeof propsQuery.data.mfaGraceDays === "number") {
        setMfaGraceDays(String(propsQuery.data.mfaGraceDays));
      }
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const apiRateLimitPerMinute = Number(rate);
      const loginFailureThreshold = Number(threshold);
      const supportsSessionTimeout = hasSessionTimeoutMinutes(propsQuery.data);
      const sessionTimeoutMinutes = Number(sessionTimeout);
      const graceDays = Number(mfaGraceDays);
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
      if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 365) {
        throw new Error("MFA grace days must be an integer from 0 to 365");
      }
      const body: {
        apiRateLimitPerMinute: number;
        loginFailureThreshold: number;
        defaultTheme: ThemeId;
        sessionTimeoutMinutes?: number;
        mfaEnforcement: MfaEnforcement;
        mfaGraceDays: number;
      } = {
        apiRateLimitPerMinute,
        loginFailureThreshold,
        defaultTheme,
        mfaEnforcement,
        mfaGraceDays: graceDays,
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
          ? ". Session timeout controls browser cookie lifetime."
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
        </>
      ) : null}

      <h3 className="profile-settings__heading" style={{ marginTop: "1.25rem" }}>
        Multi-factor authentication
      </h3>
      <label className="field">
        <span>Require MFA for</span>
        <select
          value={mfaEnforcement}
          onChange={(e) => setMfaEnforcement(e.target.value as MfaEnforcement)}
        >
          <option value="none">No one</option>
          <option value="administrators">Administrators</option>
        </select>
      </label>
      <p className="muted small" style={{ marginTop: 0 }}>
        When set to Administrators, each admin must enroll an authenticator within the grace
        period (starting on their first login after enforcement). Missing the deadline locks the
        account until an administrator unlocks it. Set <code>MFA_TOTP_KEY</code> in the server
        environment before users enroll.
      </p>
      <label className="field">
        <span>MFA enrollment grace (days)</span>
        <input
          type="number"
          min={0}
          max={365}
          value={mfaGraceDays}
          onChange={(e) => setMfaGraceDays(e.target.value)}
        />
      </label>

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
