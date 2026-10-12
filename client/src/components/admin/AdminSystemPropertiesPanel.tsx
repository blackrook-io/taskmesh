import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";
import { ThemeSwitcher } from "../shell/ThemeSwitcher";
import { isThemeId, type ThemeId } from "../../lib/theme";
import { AdminAiProvidersSection } from "./AdminAiProvidersSection";
import { AdminAiQualitySection } from "./AdminAiQualitySection";
import { AdminAiUsageSection } from "./AdminAiUsageSection";

type MfaEnforcement = "none" | "administrators";

const CONFIGURABLE_RATE_LIMIT_MIN = 10;
const CONFIGURABLE_RATE_LIMIT_MAX = 100_000;

type SystemProperties = {
  apiRateLimitPerMinute: number;
  globalApiRateLimitPerMinute?: number;
  searchRateLimitPerMinute?: number;
  loginFailureThreshold: number;
  sessionTimeoutMinutes?: number;
  maxConcurrentSessions?: number;
  defaultTheme: ThemeId;
  mfaEnforcement?: MfaEnforcement;
  mfaGraceDays?: number;
  mfaTrustedDeviceDays?: number;
  mfaTrustedDeviceMax?: number;
  aiWebFetch?: boolean;
  aiProjectAccessDefault?: "full" | "read_only" | "excluded";
  aiBudgets?: {
    tokensPerUserPerDay: number | null;
    instanceSpendUsdPerDay: number | null;
    toolCallsPerRun: number | null;
    writesPerRun: number | null;
  };
  aiInstanceUsdPerMillionTokens?: number;
  updatedAt: string | null;
};

function hasSessionTimeoutMinutes(
  data: SystemProperties | undefined,
): data is SystemProperties & { sessionTimeoutMinutes: number } {
  return typeof data?.sessionTimeoutMinutes === "number";
}

function hasMaxConcurrentSessions(
  data: SystemProperties | undefined,
): data is SystemProperties & { maxConcurrentSessions: number } {
  return typeof data?.maxConcurrentSessions === "number";
}

function hasGlobalApiRateLimit(
  data: SystemProperties | undefined,
): data is SystemProperties & { globalApiRateLimitPerMinute: number } {
  return typeof data?.globalApiRateLimitPerMinute === "number";
}

function hasSearchRateLimit(
  data: SystemProperties | undefined,
): data is SystemProperties & { searchRateLimitPerMinute: number } {
  return typeof data?.searchRateLimitPerMinute === "number";
}

function optionalPositive(raw: string, label: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${label} must be a positive integer, or blank for no cap`);
  }
  return n;
}

function configurableRateLimitError(label: string, value: number): string | null {
  if (
    !Number.isInteger(value) ||
    value < CONFIGURABLE_RATE_LIMIT_MIN ||
    value > CONFIGURABLE_RATE_LIMIT_MAX
  ) {
    return `${label} must be an integer from ${CONFIGURABLE_RATE_LIMIT_MIN} to ${CONFIGURABLE_RATE_LIMIT_MAX}`;
  }
  return null;
}

export function AdminSystemPropertiesPanel() {
  const qc = useQueryClient();
  const [rate, setRate] = useState("60");
  const [globalRate, setGlobalRate] = useState("300");
  const [searchRate, setSearchRate] = useState("60");
  const [threshold, setThreshold] = useState("3");
  const [sessionTimeout, setSessionTimeout] = useState("60");
  const [maxConcurrentSessions, setMaxConcurrentSessions] = useState("1");
  const [defaultTheme, setDefaultTheme] = useState<ThemeId>("green");
  const [mfaEnforcement, setMfaEnforcement] = useState<MfaEnforcement>("none");
  const [mfaGraceDays, setMfaGraceDays] = useState("7");
  const [mfaTrustedDeviceDays, setMfaTrustedDeviceDays] = useState("15");
  const [mfaTrustedDeviceMax, setMfaTrustedDeviceMax] = useState("5");
  const [tokenLimit, setTokenLimit] = useState("");
  const [spendLimit, setSpendLimit] = useState("");
  const [toolLimit, setToolLimit] = useState("");
  const [writeLimit, setWriteLimit] = useState("");
  const [usdPerMillion, setUsdPerMillion] = useState("1");
  const [aiWebFetch, setAiWebFetch] = useState(false);
  const [aiProjectAccessDefault, setAiProjectAccessDefault] = useState<
    "full" | "read_only" | "excluded"
  >("full");
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
      if (hasGlobalApiRateLimit(propsQuery.data)) {
        setGlobalRate(String(propsQuery.data.globalApiRateLimitPerMinute));
      }
      if (hasSearchRateLimit(propsQuery.data)) {
        setSearchRate(String(propsQuery.data.searchRateLimitPerMinute));
      }
      setThreshold(String(propsQuery.data.loginFailureThreshold));
      if (hasSessionTimeoutMinutes(propsQuery.data)) {
        setSessionTimeout(String(propsQuery.data.sessionTimeoutMinutes));
      }
      if (hasMaxConcurrentSessions(propsQuery.data)) {
        setMaxConcurrentSessions(String(propsQuery.data.maxConcurrentSessions));
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
      if (typeof propsQuery.data.mfaTrustedDeviceDays === "number") {
        setMfaTrustedDeviceDays(String(propsQuery.data.mfaTrustedDeviceDays));
      }
      if (typeof propsQuery.data.mfaTrustedDeviceMax === "number") {
        setMfaTrustedDeviceMax(String(propsQuery.data.mfaTrustedDeviceMax));
      }
      const budgets = propsQuery.data.aiBudgets;
      setTokenLimit(budgets?.tokensPerUserPerDay == null ? "" : String(budgets.tokensPerUserPerDay));
      setSpendLimit(
        budgets?.instanceSpendUsdPerDay == null ? "" : String(budgets.instanceSpendUsdPerDay),
      );
      setToolLimit(budgets?.toolCallsPerRun == null ? "" : String(budgets.toolCallsPerRun));
      setWriteLimit(budgets?.writesPerRun == null ? "" : String(budgets.writesPerRun));
      if (typeof propsQuery.data.aiInstanceUsdPerMillionTokens === "number") {
        setUsdPerMillion(String(propsQuery.data.aiInstanceUsdPerMillionTokens));
      }
      setAiWebFetch(propsQuery.data.aiWebFetch === true);
      if (
        propsQuery.data.aiProjectAccessDefault === "full" ||
        propsQuery.data.aiProjectAccessDefault === "read_only" ||
        propsQuery.data.aiProjectAccessDefault === "excluded"
      ) {
        setAiProjectAccessDefault(propsQuery.data.aiProjectAccessDefault);
      }
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const apiRateLimitPerMinute = Number(rate);
      const globalApiRateLimitPerMinute = Number(globalRate);
      const searchRateLimitPerMinute = Number(searchRate);
      const loginFailureThreshold = Number(threshold);
      const supportsGlobalRate = hasGlobalApiRateLimit(propsQuery.data);
      const supportsSearchRate = hasSearchRateLimit(propsQuery.data);
      const supportsSessionTimeout = hasSessionTimeoutMinutes(propsQuery.data);
      const supportsMaxSessions = hasMaxConcurrentSessions(propsQuery.data);
      const sessionTimeoutMinutes = Number(sessionTimeout);
      const maxSessions = Number(maxConcurrentSessions);
      const graceDays = Number(mfaGraceDays);
      const trustDays = Number(mfaTrustedDeviceDays);
      const trustMax = Number(mfaTrustedDeviceMax);
      if (!Number.isInteger(apiRateLimitPerMinute) || apiRateLimitPerMinute < 1) {
        throw new Error("API rate limit must be a positive integer");
      }
      if (supportsGlobalRate) {
        const message = configurableRateLimitError(
          "Global API rate limit",
          globalApiRateLimitPerMinute,
        );
        if (message) throw new Error(message);
      }
      if (supportsSearchRate) {
        const message = configurableRateLimitError(
          "Search rate limit",
          searchRateLimitPerMinute,
        );
        if (message) throw new Error(message);
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
      if (
        supportsMaxSessions &&
        (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 20)
      ) {
        throw new Error("Max concurrent sessions must be an integer from 1 to 20");
      }
      if (!isThemeId(defaultTheme)) {
        throw new Error("Default theme is invalid");
      }
      if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 365) {
        throw new Error("MFA grace days must be an integer from 0 to 365");
      }
      if (!Number.isInteger(trustDays) || trustDays < 0 || trustDays > 365) {
        throw new Error("Trusted device days must be an integer from 0 to 365");
      }
      if (!Number.isInteger(trustMax) || trustMax < 1 || trustMax > 50) {
        throw new Error("Trusted device max must be an integer from 1 to 50");
      }
      const tokensPerUserPerDay = optionalPositive(tokenLimit, "Tokens per user per day");
      const instanceSpendUsdPerDay = optionalPositive(spendLimit, "Instance-key spend per day");
      const toolCallsPerRun = optionalPositive(toolLimit, "Tool calls per run");
      const writesPerRun = optionalPositive(writeLimit, "Writes per run");
      const usdRate = Number(usdPerMillion);
      if (!Number.isFinite(usdRate) || usdRate < 0) {
        throw new Error("USD per million tokens must be zero or greater");
      }
      const body: {
        apiRateLimitPerMinute: number;
        globalApiRateLimitPerMinute?: number;
        searchRateLimitPerMinute?: number;
        loginFailureThreshold: number;
        defaultTheme: ThemeId;
        sessionTimeoutMinutes?: number;
        maxConcurrentSessions?: number;
        mfaEnforcement: MfaEnforcement;
        mfaGraceDays: number;
        mfaTrustedDeviceDays: number;
        mfaTrustedDeviceMax: number;
        aiWebFetch: boolean;
        aiProjectAccessDefault: "full" | "read_only" | "excluded";
        aiBudgets: {
          tokensPerUserPerDay: number | null;
          instanceSpendUsdPerDay: number | null;
          toolCallsPerRun: number | null;
          writesPerRun: number | null;
        };
        aiInstanceUsdPerMillionTokens: number;
      } = {
        apiRateLimitPerMinute,
        loginFailureThreshold,
        defaultTheme,
        mfaEnforcement,
        mfaGraceDays: graceDays,
        mfaTrustedDeviceDays: trustDays,
        mfaTrustedDeviceMax: trustMax,
        aiWebFetch,
        aiProjectAccessDefault,
        aiBudgets: {
          tokensPerUserPerDay,
          instanceSpendUsdPerDay,
          toolCallsPerRun,
          writesPerRun,
        },
        aiInstanceUsdPerMillionTokens: usdRate,
      };
      if (supportsGlobalRate) {
        body.globalApiRateLimitPerMinute = globalApiRateLimitPerMinute;
      }
      if (supportsSearchRate) {
        body.searchRateLimitPerMinute = searchRateLimitPerMinute;
      }
      if (supportsSessionTimeout) {
        body.sessionTimeoutMinutes = sessionTimeoutMinutes;
      }
      if (supportsMaxSessions) {
        body.maxConcurrentSessions = maxSessions;
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
      await qc.invalidateQueries({ queryKey: ["admin", "ai-providers"] });
      await qc.invalidateQueries({ queryKey: ["admin", "ai-usage"] });
      window.setTimeout(() => setSaved(false), 2000);
    },
    onError: (err: Error) => setError(err.message),
  });

  const supportsSessionTimeout = hasSessionTimeoutMinutes(propsQuery.data);
  const supportsMaxSessions = hasMaxConcurrentSessions(propsQuery.data);
  const supportsGlobalRate = hasGlobalApiRateLimit(propsQuery.data);
  const supportsSearchRate = hasSearchRateLimit(propsQuery.data);

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

      {supportsGlobalRate ? (
        <>
          <label className="field">
            <span>Global API rate limit (requests per minute)</span>
            <input
              type="number"
              min={CONFIGURABLE_RATE_LIMIT_MIN}
              max={CONFIGURABLE_RATE_LIMIT_MAX}
              value={globalRate}
              onChange={(e) => setGlobalRate(e.target.value)}
            />
          </label>
          <p className="muted small" style={{ marginTop: 0 }}>
            Ceiling for each signed-in user, API key, or anonymous IP on /api/v1. Takes effect
            within a few seconds of Save. Login, upload, assistant chat, and backup or import
            limits stay fixed.
          </p>
        </>
      ) : null}

      {supportsSearchRate ? (
        <>
          <label className="field">
            <span>Search rate limit (requests per minute)</span>
            <input
              type="number"
              min={CONFIGURABLE_RATE_LIMIT_MIN}
              max={CONFIGURABLE_RATE_LIMIT_MAX}
              value={searchRate}
              onChange={(e) => setSearchRate(e.target.value)}
            />
          </label>
          <p className="muted small" style={{ marginTop: 0 }}>
            Ceiling for global search, counted separately per signed-in user, API key, or
            anonymous IP.
          </p>
        </>
      ) : null}

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
        <label className="field">
          <span>Session timeout (minutes)</span>
          <input
            type="number"
            min={1}
            value={sessionTimeout}
            onChange={(e) => setSessionTimeout(e.target.value)}
          />
        </label>
      ) : null}

      {supportsMaxSessions ? (
        <>
          <label className="field">
            <span>Max concurrent sessions per user</span>
            <input
              type="number"
              min={1}
              max={20}
              value={maxConcurrentSessions}
              onChange={(e) => setMaxConcurrentSessions(e.target.value)}
            />
          </label>
          <p className="muted small" style={{ marginTop: 0 }}>
            How many signed-in sessions each user may keep. 1 signs out every other session on
            the next login.
          </p>
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
      <label className="field">
        <span>Trusted device duration (days)</span>
        <input
          type="number"
          min={0}
          max={365}
          value={mfaTrustedDeviceDays}
          onChange={(e) => setMfaTrustedDeviceDays(e.target.value)}
        />
      </label>
      <p className="muted small" style={{ marginTop: 0 }}>
        After a successful MFA challenge, users may trust the browser for this many days (skip
        TOTP). Set to <strong>0</strong> to disable. Logout does not clear trust; Profile revoke
        or Clear MFA does.
      </p>
      <label className="field">
        <span>Max trusted devices per user</span>
        <input
          type="number"
          min={1}
          max={50}
          value={mfaTrustedDeviceMax}
          onChange={(e) => setMfaTrustedDeviceMax(e.target.value)}
        />
      </label>

      {propsQuery.data?.updatedAt ? (
        <p className="muted small">
          Last saved: {new Date(propsQuery.data.updatedAt).toLocaleString()}
        </p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {saved ? <p className="ok-text">Saved.</p> : null}

      <h2>AI usage budgets</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Leave a limit blank for no cap. Counts use the UTC day. Instance-key spend is an estimate:
        tokens times the rate below. A user&apos;s own key is not counted in that spend.
      </p>
      <label className="field">
        <span>Tokens per user per day</span>
        <input
          type="number"
          min={1}
          value={tokenLimit}
          onChange={(e) => setTokenLimit(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Instance-key spend per day (USD)</span>
        <input
          type="number"
          min={1}
          value={spendLimit}
          onChange={(e) => setSpendLimit(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Tool calls per run</span>
        <input
          type="number"
          min={1}
          value={toolLimit}
          onChange={(e) => setToolLimit(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Writes per run</span>
        <input
          type="number"
          min={1}
          value={writeLimit}
          onChange={(e) => setWriteLimit(e.target.value)}
        />
      </label>
      <label className="field">
        <span>USD per million tokens (instance key)</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={usdPerMillion}
          onChange={(e) => setUsdPerMillion(e.target.value)}
        />
      </label>

      <h2>Assistant web access</h2>
      <label className="field" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={aiWebFetch}
          onChange={(e) => setAiWebFetch(e.target.checked)}
        />
        <span>Allow assistant chat to fetch public web pages</span>
      </label>
      <p className="muted small" style={{ marginTop: 0 }}>
        Off by default. Background AI features cannot fetch the web. Private and local addresses
        stay blocked. Save with the button below.
      </p>

      <h2>Project AI access</h2>
      <label className="field">
        <span>Instance default</span>
        <select
          value={aiProjectAccessDefault}
          onChange={(e) =>
            setAiProjectAccessDefault(e.target.value as "full" | "read_only" | "excluded")
          }
        >
          <option value="full">Full</option>
          <option value="read_only">Read-only</option>
          <option value="excluded">Excluded</option>
        </select>
      </label>
      <p className="muted small" style={{ marginTop: 0 }}>
        New projects start here. A project owner or manager can only narrow this. Excluded
        projects are never sent to a model. Read-only projects can be read but not changed by AI.
      </p>

      <button
        type="button"
        className="btn primary small"
        disabled={saveMutation.isPending}
        onClick={() => saveMutation.mutate()}
      >
        Save
      </button>
      <AdminAiProvidersSection />
      <AdminAiUsageSection />
      <AdminAiQualitySection />
    </div>
  );
}
