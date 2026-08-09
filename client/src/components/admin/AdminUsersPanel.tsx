import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";

type AdminUser = {
  id: number;
  referenceId: string;
  displayName: string;
  email: string | null;
  deactivatedAt: string | null;
  lockedAt: string | null;
  lastLoginAt: string | null;
  lastApiAt: string | null;
  hasPassword: boolean;
  failedLoginCount: number;
};

export function AdminUsersPanel() {
  const qc = useQueryClient();
  const [passwordUserId, setPasswordUserId] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const res = await apiJson<{ data: AdminUser[] }>("/api/v1/admin/users");
      return res.data;
    },
  });

  const resetMutation = useMutation({
    mutationFn: async ({ id, password }: { id: number; password: string }) => {
      await apiJson(`/api/v1/admin/users/${id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
    },
    onSuccess: async () => {
      setPasswordUserId(null);
      setPassword("");
      setPassword2("");
      setFormError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/admin/users/${id}/deactivate`, { method: "POST" });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      await qc.invalidateQueries({ queryKey: ["admin", "api-keys"] });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/admin/users/${id}/reactivate`, { method: "POST" });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const users = usersQuery.data ?? [];

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        All users. Reset password stores a hash for future login. Deactivate blocks future
        logins and immediately revokes that user&apos;s API keys.
      </p>
      {usersQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {usersQuery.isError ? (
        <p className="error-text">{(usersQuery.error as Error).message}</p>
      ) : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Status</th>
              <th>Password</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.displayName}</strong>
                  <div className="muted small">{u.referenceId}</div>
                </td>
                <td>{u.email ?? <span className="muted">—</span>}</td>
                <td>
                  {u.deactivatedAt ? (
                    <span className="admin-badge admin-badge--danger">Deactivated</span>
                  ) : u.lockedAt ? (
                    <span className="admin-badge admin-badge--warn">Locked</span>
                  ) : (
                    <span className="admin-badge admin-badge--ok">Active</span>
                  )}
                </td>
                <td>{u.hasPassword ? "Set" : <span className="muted">None</span>}</td>
                <td className="admin-table__actions">
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => {
                      setPasswordUserId(u.id);
                      setPassword("");
                      setPassword2("");
                      setFormError(null);
                    }}
                  >
                    Reset password
                  </button>
                  {u.deactivatedAt ? (
                    <button
                      type="button"
                      className="btn ghost small"
                      disabled={reactivateMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`Reactivate ${u.referenceId}?`)) {
                          reactivateMutation.mutate(u.id);
                        }
                      }}
                    >
                      Reactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn ghost small"
                      disabled={deactivateMutation.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Deactivate ${u.referenceId}? Logins will fail and all API keys will be revoked.`,
                          )
                        ) {
                          deactivateMutation.mutate(u.id);
                        }
                      }}
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {passwordUserId != null ? (
        <div className="admin-form-card" role="dialog" aria-label="Reset password">
          <h3 className="admin-form-card__title">Reset password</h3>
          <p className="muted small">
            Min 12 characters with upper, lower, digit, and symbol. Avoid common words,
            sequences, repeats, and keyboard runs.
          </p>
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Confirm</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
          </label>
          {formError ? <p className="error-text">{formError}</p> : null}
          {password && password2 && password !== password2 ? (
            <p className="error-text">Passwords do not match</p>
          ) : null}
          <div className="admin-form-card__actions">
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setPasswordUserId(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary small"
              disabled={
                resetMutation.isPending ||
                !password ||
                password !== password2
              }
              onClick={() =>
                resetMutation.mutate({ id: passwordUserId, password })
              }
            >
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
