import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";
import { validateEmailClient, validatePasswordClient } from "../../lib/password";
import type { UserProfile } from "../../types";

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

const PASSWORD_HELP =
  "Min 12 characters with upper, lower, digit, and symbol. Avoid common words, sequences, repeats, and keyboard runs.";

export function AdminUsersPanel() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createPassword2, setCreatePassword2] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [passwordUserId, setPasswordUserId] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const res = await apiJson<{ data: AdminUser[] }>("/api/v1/admin/users");
      return res.data;
    },
  });

  const meQuery = useQuery({
    queryKey: ["users", "me"],
    queryFn: async () => {
      const res = await apiJson<{ data: UserProfile }>("/api/v1/users/me");
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiJson("/api/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({
          displayName: createName.trim(),
          email: createEmail.trim(),
          password: createPassword,
        }),
      });
    },
    onSuccess: async () => {
      setCreating(false);
      setCreateName("");
      setCreateEmail("");
      setCreatePassword("");
      setCreatePassword2("");
      setCreateError(null);
      setActionError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: Error) => setCreateError(err.message),
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
      setActionError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      await qc.invalidateQueries({ queryKey: ["admin", "api-keys"] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/admin/users/${id}/reactivate`, { method: "POST" });
    },
    onSuccess: async () => {
      setActionError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const lockMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/admin/users/${id}/lock`, { method: "POST" });
    },
    onSuccess: async () => {
      setActionError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const unlockMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/admin/users/${id}/unlock`, { method: "POST" });
    },
    onSuccess: async () => {
      setActionError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/admin/users/${id}`, { method: "DELETE" });
    },
    onSuccess: async () => {
      setActionError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      await qc.invalidateQueries({ queryKey: ["admin", "api-keys"] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const users = usersQuery.data ?? [];
  const meId = meQuery.data?.id;
  const isLastUser = users.length <= 1;
  const createEmailError = createEmail.length > 0 ? validateEmailClient(createEmail) : null;
  const createPasswordError =
    createPassword.length > 0 ? validatePasswordClient(createPassword) : null;
  const createMismatch =
    Boolean(createPassword && createPassword2 && createPassword !== createPassword2);
  const createCanSubmit =
    createName.trim().length > 0 &&
    !createEmailError &&
    createEmail.trim().length > 0 &&
    !createPasswordError &&
    createPassword.length > 0 &&
    createPassword === createPassword2 &&
    !createMutation.isPending;

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        All users. Create accounts with email and password for future login. Lock is
        temporary (distinct from Deactivate, which also revokes API keys). Delete is
        permanent and blocked for the last remaining user, the signed-in user, and users
        who have authored tasks or ToDos.
      </p>
      {usersQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {usersQuery.isError ? (
        <p className="error-text">{(usersQuery.error as Error).message}</p>
      ) : null}
      {actionError ? <p className="error-text">{actionError}</p> : null}

      <div className="admin-toolbar">
        <button
          type="button"
          className="btn primary small"
          onClick={() => {
            setCreating(true);
            setPasswordUserId(null);
            setCreateError(null);
          }}
        >
          Create user
        </button>
      </div>

      {creating ? (
        <div className="admin-form-card" role="dialog" aria-label="Create user">
          <h3 className="admin-form-card__title">Create user</h3>
          <p className="muted small">{PASSWORD_HELP}</p>
          <label className="field">
            <span>Display name</span>
            <input
              type="text"
              autoComplete="off"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="off"
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
            />
          </label>
          {createEmailError ? <p className="error-text">{createEmailError}</p> : null}
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
            />
          </label>
          {createPasswordError ? (
            <p className="error-text">{createPasswordError}</p>
          ) : null}
          <label className="field">
            <span>Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={createPassword2}
              onChange={(e) => setCreatePassword2(e.target.value)}
            />
          </label>
          {createMismatch ? <p className="error-text">Passwords do not match</p> : null}
          {createError ? <p className="error-text">{createError}</p> : null}
          <div className="admin-form-card__actions">
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary small"
              disabled={!createCanSubmit}
              onClick={() => createMutation.mutate()}
            >
              Create
            </button>
          </div>
        </div>
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
            {users.map((u) => {
              const isSelf = meId != null && u.id === meId;
              const cannotDelete = isLastUser || isSelf;
              const deleteTitle = isLastUser
                ? "Cannot delete the last remaining user"
                : isSelf
                  ? "Cannot delete the signed-in user"
                  : undefined;
              return (
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
                        setCreating(false);
                        setPassword("");
                        setPassword2("");
                        setFormError(null);
                      }}
                    >
                      Reset password
                    </button>
                    {!u.deactivatedAt ? (
                      u.lockedAt ? (
                        <button
                          type="button"
                          className="btn ghost small"
                          disabled={unlockMutation.isPending}
                          onClick={() => unlockMutation.mutate(u.id)}
                        >
                          Unlock
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn ghost small"
                          disabled={lockMutation.isPending}
                          onClick={() => lockMutation.mutate(u.id)}
                        >
                          Lock
                        </button>
                      )
                    ) : null}
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
                    <button
                      type="button"
                      className="btn ghost small"
                      disabled={cannotDelete || deleteMutation.isPending}
                      title={deleteTitle}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete ${u.referenceId} (${u.displayName})? This cannot be undone.`,
                          )
                        ) {
                          deleteMutation.mutate(u.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {passwordUserId != null ? (
        <div className="admin-form-card" role="dialog" aria-label="Reset password">
          <h3 className="admin-form-card__title">Reset password</h3>
          <p className="muted small">{PASSWORD_HELP}</p>
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
                resetMutation.isPending || !password || password !== password2
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
