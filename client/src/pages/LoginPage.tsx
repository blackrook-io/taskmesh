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
};

function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/login")) return "/";
  return raw;
}

type PublicProvider = { slug: string; name: string };

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, setUser } = useAuth();
  const returnTo = safeReturnTo(params.get("returnTo"));
  const sessionEnded = params.get("reason") === "session";
  const oauthError = params.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    resetSessionExpiredGuard();
  }, []);

  useEffect(() => {
    if (oauthError) {
      setError(OAUTH_ERROR_MESSAGES[oauthError] ?? OAUTH_ERROR_MESSAGES.oauth_failed);
    }
  }, [oauthError]);

  const configQuery = useQuery({
    queryKey: ["config", "public"],
    queryFn: async () => {
      const res = await apiJson<{
        data: {
          defaultTheme?: string;
          instance?: "dev" | "prod";
          instanceTheme?: string | null;
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

  useEffect(() => {
    if (!configQuery.data) return;
    const theme = resolveSystemDefaultFromConfig(configQuery.data);
    applyTheme(theme);
    if (configQuery.data.instance) {
      applyInstanceFavicon(configQuery.data.instance);
    }
  }, [configQuery.data]);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: UserProfile }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const sessionRes = await fetch("/api/v1/auth/session", {
        credentials: "include",
        headers: { "X-TaskMesh-Client": "ui" },
      });
      if (!sessionRes.ok) {
        throw new Error(
          "Signed in, but the session cookie was not stored. Clear site cookies for this host (including https://127.0.0.1 / https://localhost), or open DEV via http://<lan-ip>:5173.",
        );
      }
      return res.data;
    },
    onSuccess: (profile) => {
      setError(null);
      setUser(profile);
      navigate(returnTo, { replace: true });
    },
    onError: (err: Error) => {
      setError(err.message || LOGIN_ERROR);
    },
  });

  if (user) {
    return <Navigate to={returnTo} replace />;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError(LOGIN_ERROR);
      return;
    }
    loginMutation.mutate();
  }

  const providers = oauthQuery.data ?? [];

  return (
    <div className="login-page">
      <div className="login-card">
        <header className="login-card__header">
          <MeshMark className="login-card__mark" title="TaskMesh" />
          <h1 className="login-card__title">TaskMesh</h1>
        </header>

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
              disabled={loginMutation.isPending}
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
              disabled={loginMutation.isPending}
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
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
