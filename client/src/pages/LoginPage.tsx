import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { apiJson } from "../api/client";
import { useAuth } from "../lib/auth";
import {
  applyInstanceFavicon,
  resolveSystemDefaultFromConfig,
} from "../lib/instanceBrand";
import { applyTheme } from "../lib/theme";
import { MeshMark } from "../components/shell/MeshMark";
import type { UserProfile } from "../types";

const LOGIN_ERROR = "Invalid email or password.";

function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/login")) return "/";
  return raw;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, setUser } = useAuth();
  const returnTo = safeReturnTo(params.get("returnTo"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="login-page">
      <div className="login-card">
        <header className="login-card__header">
          <MeshMark className="login-card__mark" title="TaskMesh" />
          <h1 className="login-card__title">TaskMesh</h1>
        </header>

        <form className="login-form" onSubmit={onSubmit} noValidate>
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
