import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { apiJson } from "../api/client";
import { resetSessionExpiredGuard } from "../api/sessionExpired";
import { useAuth } from "../lib/auth";
import {
  applyInstanceFavicon,
  resolveSystemDefaultFromConfig,
} from "../lib/instanceBrand";
import { applyTheme } from "../lib/theme";
import { MeshMark } from "../components/shell/MeshMark";
import type { UserProfile } from "../types";

const LOGIN_ERROR = "Invalid email or password.";
const SESSION_ENDED_MESSAGE = "Your session ended. Sign in again to continue.";

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: "Sign-in was cancelled.",
  oauth_failed: "Sign-in with the identity provider failed.",
  oauth_expired: "Sign-in timed out. Please try again.",
  oauth_no_account:
    "No TaskMesh account matches that identity. Ask an administrator to create your account or enable JIT for the provider.",
  oauth_misconfigured: "This sign-in provider is not configured correctly.",
  oauth_conflict: "That identity is already linked to another account.",
  mfa_locked:
    "Your account is locked because multi-factor authentication was not set up in time. Contact an administrator to unlock your account.",
  account_locked: "Your account is locked. Contact an administrator.",
};

function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/login")) return "/";
  return raw;
}

type PublicProvider = { slug: string; name: string };

type LoginResponse =
  | { data: UserProfile & { mfaEnrollmentRequired?: boolean } }
  | {
      data: {
        mfaRequired: true;
        trustedDeviceDays?: number;
      };
    };

function isMfaChallenge(
  data: LoginResponse["data"],
): data is { mfaRequired: true; trustedDeviceDays?: number } {
  return (
    typeof data === "object" &&
    data !== null &&
    "mfaRequired" in data &&
    (data as { mfaRequired?: unknown }).mfaRequired === true
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, setUser } = useAuth();
  const returnTo = safeReturnTo(params.get("returnTo"));
  const sessionEnded = params.get("reason") === "session";
  const oauthError = params.get("error");
  const oauthMfa = params.get("mfa") === "1";
  const oauthTrustDaysRaw = params.get("mfaTrustDays");
  const oauthTrustDays = oauthTrustDaysRaw != null ? Number(oauthTrustDaysRaw) : null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  /** Password-login MFA pending (challenge id lives in HttpOnly cookie). */
  const [mfaPending, setMfaPending] = useState(false);
  const [passwordTrustDays, setPasswordTrustDays] = useState<number | null>(null);
  const [trustDevice, setTrustDevice] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    oauthError
      ? (OAUTH_ERROR_MESSAGES[oauthError] ?? OAUTH_ERROR_MESSAGES.oauth_failed)
      : null,
  );

  const showMfa = mfaPending || oauthMfa;

  useEffect(() => {
    resetSessionExpiredGuard();
  }, []);

  const configQuery = useQuery({
    queryKey: ["config", "public"],
    queryFn: async () => {
      const res = await apiJson<{
        data: {
          defaultTheme?: string;
          instance?: "dev" | "prod";
          instanceTheme?: string | null;
          mfaTrustedDeviceDays?: number;
        };
      }>("/api/v1/config");
      return res.data;
    },
  });

  const oauthQuery = useQuery({
    queryKey: ["auth", "oauth-providers"],
    queryFn: async () => {
      const res = await apiJson<{ data: PublicProvider[] }>("/api/v1/auth/oauth/providers");
      return res.data;
    },
  });

  const trustedDeviceDays = (() => {
    if (mfaPending && passwordTrustDays != null) return passwordTrustDays;
    if (oauthMfa) {
      if (oauthTrustDays != null && Number.isFinite(oauthTrustDays)) {
        return Math.max(0, Math.floor(oauthTrustDays));
      }
      return typeof configQuery.data?.mfaTrustedDeviceDays === "number"
        ? configQuery.data.mfaTrustedDeviceDays
        : 0;
    }
    return 0;
  })();

  useEffect(() => {
    if (!configQuery.data) return;
    const theme = resolveSystemDefaultFromConfig(configQuery.data);
    applyTheme(theme);
    if (configQuery.data.instance) {
      applyInstanceFavicon(configQuery.data.instance);
    }
  }, [configQuery.data]);

  const finishLogin = (profile: UserProfile, enrollmentRequired?: boolean) => {
    setError(null);
    setUser(profile);
    if (enrollmentRequired) {
      navigate("/settings/profile?mfa=enroll", { replace: true });
      return;
    }
    navigate(returnTo, { replace: true });
  };

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await apiJson<LoginResponse>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (isMfaChallenge(res.data)) {
        return {
          kind: "mfa" as const,
          trustedDeviceDays: res.data.trustedDeviceDays ?? 0,
        };
      }
      const sessionRes = await fetch("/api/v1/auth/session", {
        credentials: "include",
        headers: { "X-TaskMesh-Client": "ui" },
      });
      if (!sessionRes.ok) {
        throw new Error(
          "Signed in, but the session cookie was not stored. Clear site cookies for this host (including https://127.0.0.1 / https://localhost), or open DEV via http://<lan-ip>:5173.",
        );
      }
      return {
        kind: "ok" as const,
        profile: res.data as UserProfile & { mfaEnrollmentRequired?: boolean },
      };
    },
    onSuccess: (result) => {
      if (result.kind === "mfa") {
        setMfaPending(true);
        setPasswordTrustDays(result.trustedDeviceDays);
        setTrustDevice(false);
        setUseBackupCode(false);
        setMfaCode("");
        setError(null);
        return;
      }
      finishLogin(result.profile, result.profile.mfaEnrollmentRequired);
    },
    onError: (err: Error) => {
      setError(err.message || LOGIN_ERROR);
    },
  });

  const mfaMutation = useMutation({
    mutationFn: async () => {
      if (!showMfa) throw new Error("Missing MFA challenge.");
      const res = await apiJson<{ data: UserProfile }>("/api/v1/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({
          code: mfaCode,
          trustDevice: trustedDeviceDays > 0 ? trustDevice : false,
        }),
      });
      const sessionRes = await fetch("/api/v1/auth/session", {
        credentials: "include",
        headers: { "X-TaskMesh-Client": "ui" },
      });
      if (!sessionRes.ok) {
        throw new Error("MFA verified, but the session cookie was not stored.");
      }
      return res.data;
    },
    onSuccess: (profile) => {
      setMfaPending(false);
      setPasswordTrustDays(null);
      setTrustDevice(false);
      finishLogin(profile);
    },
    onError: (err: Error) => {
      setError(err.message || (useBackupCode ? "Invalid recovery code." : "Invalid authenticator code."));
    },
  });

  if (user) {
    return <Navigate to={returnTo} replace />;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (showMfa) {
      const trimmed = mfaCode.trim();
      if (useBackupCode) {
        if (trimmed.replace(/[^a-zA-Z0-9]/g, "").length < 8) {
          setError("Enter a backup recovery code.");
          return;
        }
      } else if (trimmed.length < 6) {
        setError("Enter the 6-digit code from your authenticator app.");
        return;
      }
      mfaMutation.mutate();
      return;
    }
    if (!email.trim() || !password) {
      setError(LOGIN_ERROR);
      return;
    }
    loginMutation.mutate();
  }

  const providers = oauthQuery.data ?? [];
  const pending = loginMutation.isPending || mfaMutation.isPending;

  return (
    <div className="login-page">
      <div className="login-card">
        <header className="login-card__header">
          <MeshMark className="login-card__mark" title="TaskMesh" />
          <h1 className="login-card__title">TaskMesh</h1>
        </header>

        {showMfa ? (
          <form className="login-form" onSubmit={onSubmit} noValidate>
            <p className="muted" style={{ marginTop: 0 }}>
              {useBackupCode
                ? "Enter one of your single-use backup codes."
                : "Enter the 6-digit code from your authenticator app."}
            </p>
            <label className="field">
              <span>{useBackupCode ? "Backup code" : "Authenticator code"}</span>
              <input
                type="text"
                name="mfa"
                inputMode={useBackupCode ? "text" : "numeric"}
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                disabled={pending}
                required
                autoFocus
                placeholder={useBackupCode ? "XXXX-XXXX" : undefined}
              />
            </label>
            <button
              type="button"
              className="btn ghost"
              style={{ alignSelf: "flex-start", padding: 0, marginBottom: "0.5rem" }}
              disabled={pending}
              onClick={() => {
                setUseBackupCode((v) => !v);
                setMfaCode("");
                setError(null);
              }}
            >
              {useBackupCode ? "Use authenticator code" : "Use a backup code"}
            </button>
            {trustedDeviceDays > 0 ? (
              <label
                className="field"
                style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}
              >
                <input
                  type="checkbox"
                  checked={trustDevice}
                  onChange={(e) => setTrustDevice(e.target.checked)}
                  disabled={pending}
                />
                <span>Trust this device for {trustedDeviceDays} days</span>
              </label>
            ) : null}
            {error ? (
              <p className="error-text login-form__error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn primary login-form__submit" disabled={pending}>
              {mfaMutation.isPending ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              className="btn secondary"
              style={{ marginTop: "0.5rem", width: "100%" }}
              disabled={pending}
              onClick={() => {
                setMfaPending(false);
                setPasswordTrustDays(null);
                setMfaCode("");
                setTrustDevice(false);
                setUseBackupCode(false);
                setError(null);
                const next = new URLSearchParams(params);
                next.delete("mfa");
                next.delete("mfaTrustDays");
                next.delete("mfaChallenge");
                navigate({ pathname: "/login", search: next.toString() }, { replace: true });
              }}
            >
              Back to sign in
            </button>
          </form>
        ) : (
          <>
            {providers.length > 0 ? (
              <div className="login-oauth">
                {providers.map((p) => {
                  const startUrl = new URL(
                    `/api/v1/auth/oauth/${p.slug}/start`,
                    window.location.origin,
                  );
                  if (returnTo !== "/") startUrl.searchParams.set("returnTo", returnTo);
                  return (
                    <a
                      key={p.slug}
                      className="btn secondary login-oauth__btn"
                      href={startUrl.pathname + startUrl.search}
                    >
                      Continue with {p.name}
                    </a>
                  );
                })}
                <p className="login-oauth__divider muted">or</p>
              </div>
            ) : null}

            <form className="login-form" onSubmit={onSubmit} noValidate>
              {sessionEnded ? (
                <p className="login-form__banner" role="status">
                  {SESSION_ENDED_MESSAGE}
                </p>
              ) : null}

              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={pending}
                  required
                />
              </label>

              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={pending}
                  required
                />
              </label>

              {error ? (
                <p className="error-text login-form__error" role="alert">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                className="btn primary login-form__submit"
                disabled={pending}
              >
                {loginMutation.isPending ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
