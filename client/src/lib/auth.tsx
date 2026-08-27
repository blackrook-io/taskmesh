import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserProfile } from "../types";

type AuthContextValue = {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: UserProfile) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchSession(): Promise<UserProfile | null> {
  const res = await fetch("/api/v1/auth/session", {
    credentials: "include",
    headers: { "X-TaskMesh-Client": "ui" },
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    const json = (await res.json()) as { error?: { message?: string } };
    throw new Error(json.error?.message ?? res.statusText);
  }
  const json = (await res.json()) as { data: UserProfile };
  return json.data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [loginUser, setLoginUser] = useState<UserProfile | null>(null);

  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: fetchSession,
    retry: false,
    staleTime: 30_000,
  });

  const user = loginUser ?? sessionQuery.data ?? null;
  const loading = sessionQuery.isLoading && loginUser == null;

  const refresh = useCallback(async () => {
    setLoginUser(null);
    await qc.invalidateQueries({ queryKey: ["auth", "session"] });
  }, [qc]);

  const logout = useCallback(async () => {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "X-TaskMesh-Client": "ui" },
    });
    setLoginUser(null);
    qc.clear();
    await qc.invalidateQueries({ queryKey: ["auth", "session"] });
  }, [qc]);

  const setUser = useCallback((next: UserProfile) => {
    setLoginUser(next);
    qc.setQueryData(["auth", "session"], next);
  }, [qc]);

  const value = useMemo(
    () => ({
      user,
      loading,
      error: sessionQuery.error instanceof Error ? sessionQuery.error.message : null,
      refresh,
      logout,
      setUser,
    }),
    [user, loading, sessionQuery.error, refresh, logout, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
