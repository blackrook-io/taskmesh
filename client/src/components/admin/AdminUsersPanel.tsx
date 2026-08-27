import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";
import { validateEmailClient, validatePasswordClient } from "../../lib/password";
import { roleIsAdministrator, type RoleRef } from "../../lib/roles";
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
  roles: RoleRef[];
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
  const [newRoleName, setNewRoleName] = useState("");
  const [roleError, setRoleError] = useState<string | null>(null);

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

  const rolesQuery = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: async () => {
      const res = await apiJson<{ data: RoleRef[] }>("/api/v1/admin/roles");
      return res.data;
    },
  });

  async function refreshRolesAndUsers() {
    setActionError(null);
    setRoleError(null);
    await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    await qc.invalidateQueries({ queryKey: ["admin", "roles"] });
    await qc.invalidateQueries({ queryKey: ["auth", "session"] });
    await qc.invalidateQueries({ queryKey: ["users", "me"] });
  }

  const createRoleMutation = useMutation({
    mutationFn: async (name: string) => {
      await apiJson("/api/v1/admin/roles", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    },
    onSuccess: async () => {
      setNewRoleName("");
      await refreshRolesAndUsers();
    },
    onError: (err: Error) => setRoleError(err.message),
  });

  const renameRoleMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      await apiJson(`/api/v1/admin/roles/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
    },
    onSuccess: async () => {
      await refreshRolesAndUsers();
    },
    onError: (err: Error) => setRoleError(err.message),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/admin/roles/${id}`, { method: "DELETE" });
    },
    onSuccess: async () => {
      await refreshRolesAndUsers();
    },
    onError: (err: Error) => setRoleError(err.message),
  });

  const assignRoleMutation = useMutation({
    mutationFn: async ({ userId, roleId }: { userId: number; roleId: number }) => {
      await apiJson(`/api/v1/admin/users/${userId}/roles`, {
        method: "POST",
        body: JSON.stringify({ roleId }),
      });
    },
    onSuccess: async () => {
      await refreshRolesAndUsers();
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const removeRoleMutation = useMutation({
    mutationFn: async ({ userId, roleId }: { userId: number; roleId: number }) => {
      await apiJson(`/api/v1/admin/users/${userId}/roles/${roleId}`, {
        method: "DELETE",
      });
    },
    onSuccess: async () => {
      await refreshRolesAndUsers();
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const users = usersQuery.data ?? [];
  const allRoles = rolesQuery.data ?? [];
  const meId = meQuery.data?.id;
  const isLastUser = users.length <= 1;
  const adminCount = users.filter((u) =>
    (u.roles ?? []).some((r) => roleIsAdministrator(r)),
  ).length;
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
        All users. Create accounts with email and password. Lock is temporary
        (distinct from Deactivate, which also revokes API keys). Delete is
        permanent and blocked for the last remaining user, the signed-in user,
        users who have authored tasks or ToDos, and the last Administrator.
        Only Administrators can open this section.
      </p>
      {usersQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {usersQuery.isError ? (
        <p className="error-text">{(usersQuery.error as Error).message}</p>
      ) : null}
      {actionError ? <p className="error-text">{actionError}</p> : null}

      <div className="admin-form-card">
        <h3 className="admin-form-card__title">Roles</h3>
        <p className="muted small">
          Administrator is a system role and cannot be deleted. Custom roles are
          labels only — they do not grant Administration access.
        </p>
        <ul className="admin-role-list">
          {allRoles.map((role) => (
            <li key={role.id} className="admin-role-list__row">
              <span>
                {role.name}
                {role.isSystem ? (
                  <span className="muted small"> · system</span>
                ) : (
                  <span className="muted small"> · {role.slug}</span>
                )}
              </span>
              {!role.isSystem ? (
                <span className="admin-role-list__actions">
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={renameRoleMutation.isPending}
                    onClick={() => {
                      const next = window.prompt("Rename role", role.name);
                      if (next && next.trim() && next.trim() !== role.name) {
                        renameRoleMutation.mutate({ id: role.id, name: next.trim() });
                      }
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={deleteRoleMutation.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete role “${role.name}”? Assignments will be removed.`)) {
                        deleteRoleMutation.mutate(role.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <label className="field">
          <span>New custom role</span>
          <input
            type="text"
            autoComplete="off"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newRoleName.trim()) {
                createRoleMutation.mutate(newRoleName.trim());
              }
            }}
          />
        </label>
        {roleError ? <p className="error-text">{roleError}</p> : null}
        <div className="admin-form-card__actions">
          <button
            type="button"
            className="btn primary small"
            disabled={!newRoleName.trim() || createRoleMutation.isPending}
            onClick={() => createRoleMutation.mutate(newRoleName.trim())}
          >
            Create role
          </button>
        </div>
      </div>

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
              const userRoles = u.roles ?? [];
              const isLastAdmin =
                adminCount <= 1 && userRoles.some((r) => roleIsAdministrator(r));
              const cannotDelete = isLastUser || isSelf || isLastAdmin;
              const deleteTitle = isLastUser
                ? "Cannot delete the last remaining user"
                : isSelf
                  ? "Cannot delete the signed-in user"
                  : isLastAdmin
                    ? "Cannot delete the last Administrator"
                    : undefined;
              const availableRoles = allRoles.filter(
                (r) => !userRoles.some((ur) => ur.id === r.id),
              );
              return (
                <tr key={u.id}>
                  <td>
                    <strong>{u.displayName}</strong>
                    <div className="muted small">{u.referenceId}</div>
                    <div className="admin-role-chips">
                      {userRoles.length === 0 ? (
                        <span className="muted small">No roles</span>
                      ) : (
                        userRoles.map((role) => {
                          const blockRemove =
                            roleIsAdministrator(role) && isLastAdmin;
                          return (
                            <span key={role.id} className="tag-chip tag-chip--removable">
                              <span className="tag-chip__name">{role.name}</span>
                              <button
                                type="button"
                                className="tag-chip__remove"
                                disabled={blockRemove || removeRoleMutation.isPending}
                                title={
                                  blockRemove
                                    ? "Cannot remove the last Administrator"
                                    : `Remove ${role.name}`
                                }
                                aria-label={`Remove ${role.name}`}
                                onClick={() =>
                                  removeRoleMutation.mutate({
                                    userId: u.id,
                                    roleId: role.id,
                                  })
                                }
                              >
                                ×
                              </button>
                            </span>
                          );
                        })
                      )}
                      {availableRoles.length > 0 ? (
                        <select
                          className="admin-role-add"
                          aria-label={`Add role to ${u.displayName}`}
                          defaultValue=""
                          disabled={assignRoleMutation.isPending}
                          onChange={(e) => {
                            const roleId = Number(e.target.value);
                            e.currentTarget.value = "";
                            if (Number.isFinite(roleId) && roleId > 0) {
                              assignRoleMutation.mutate({ userId: u.id, roleId });
                            }
                          }}
                        >
                          <option value="">Add role…</option>
                          {availableRoles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
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
                          disabled={lockMutation.isPending || isLastAdmin}
                          title={
                            isLastAdmin ? "Cannot lock the last Administrator" : undefined
                          }
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
                        disabled={deactivateMutation.isPending || isLastAdmin}
                        title={
                          isLastAdmin
                            ? "Cannot deactivate the last Administrator"
                            : undefined
                        }
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
