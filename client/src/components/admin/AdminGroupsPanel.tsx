import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiJson } from "../../api/client";
import { roleIsAdministrator, type RoleRef } from "../../lib/roles";
import { ConfirmDialog } from "../ConfirmDialog";

type GroupSummary = {
  id: number;
  referenceId: string;
  name: string;
  memberCount: number;
  roles: RoleRef[];
  createdAt: string;
  updatedAt: string;
};

type GroupMember = {
  id: number;
  referenceId: string;
  displayName: string;
  email: string | null;
};

type GroupDetail = GroupSummary & {
  members: GroupMember[];
};

type AdminUser = {
  id: number;
  referenceId: string;
  displayName: string;
  email: string | null;
  deactivatedAt: string | null;
  lockedAt: string | null;
};

export function AdminGroupsPanel() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [renameName, setRenameName] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const groupsQuery = useQuery({
    queryKey: ["admin", "groups"],
    queryFn: async () => {
      const res = await apiJson<{ data: GroupSummary[] }>("/api/v1/admin/groups");
      return res.data;
    },
  });

  const detailQuery = useQuery({
    queryKey: ["admin", "groups", selectedId],
    enabled: selectedId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: GroupDetail }>(
        `/api/v1/admin/groups/${selectedId}`,
      );
      return res.data;
    },
  });

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    enabled: selectedId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: AdminUser[] }>("/api/v1/admin/users");
      return res.data;
    },
  });

  const rolesQuery = useQuery({
    queryKey: ["admin", "roles"],
    enabled: selectedId != null,
    queryFn: async () => {
      const res = await apiJson<{ data: RoleRef[] }>("/api/v1/admin/roles");
      return res.data;
    },
  });

  async function refreshGroups(detailId?: number | null) {
    setActionError(null);
    await qc.invalidateQueries({ queryKey: ["admin", "groups"] });
    if (detailId != null) {
      await qc.invalidateQueries({ queryKey: ["admin", "groups", detailId] });
    }
    await qc.invalidateQueries({ queryKey: ["auth", "session"] });
    await qc.invalidateQueries({ queryKey: ["users", "me"] });
  }

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiJson<{ data: GroupDetail }>("/api/v1/admin/groups", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      return res.data;
    },
    onSuccess: async (data) => {
      setCreating(false);
      setCreateName("");
      setCreateError(null);
      setSelectedId(data.id);
      setRenameName(data.name);
      setMemberSearch("");
      await refreshGroups();
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiJson<{ data: GroupDetail }>(`/api/v1/admin/groups/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      return res.data;
    },
    onSuccess: async (data) => {
      setRenameName(data.name);
      await refreshGroups(data.id);
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/admin/groups/${id}`, { method: "DELETE" });
    },
    onSuccess: async () => {
      setDeleteConfirm(false);
      setSelectedId(null);
      setRenameName("");
      setMemberSearch("");
      await refreshGroups();
    },
    onError: (err: Error) => {
      setDeleteConfirm(false);
      setActionError(err.message);
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async ({ groupId, userId }: { groupId: number; userId: number }) => {
      await apiJson(`/api/v1/admin/groups/${groupId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
    },
    onSuccess: async (_data, vars) => {
      setMemberSearch("");
      await refreshGroups(vars.groupId);
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const removeMemberMutation = useMutation({
    mutationFn: async ({ groupId, userId }: { groupId: number; userId: number }) => {
      await apiJson(`/api/v1/admin/groups/${groupId}/members/${userId}`, {
        method: "DELETE",
      });
    },
    onSuccess: async (_data, vars) => {
      await refreshGroups(vars.groupId);
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const assignRoleMutation = useMutation({
    mutationFn: async ({ groupId, roleId }: { groupId: number; roleId: number }) => {
      await apiJson(`/api/v1/admin/groups/${groupId}/roles`, {
        method: "POST",
        body: JSON.stringify({ roleId }),
      });
    },
    onSuccess: async (_data, vars) => {
      await refreshGroups(vars.groupId);
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const removeRoleMutation = useMutation({
    mutationFn: async ({ groupId, roleId }: { groupId: number; roleId: number }) => {
      await apiJson(`/api/v1/admin/groups/${groupId}/roles/${roleId}`, {
        method: "DELETE",
      });
    },
    onSuccess: async (_data, vars) => {
      await refreshGroups(vars.groupId);
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const groups = groupsQuery.data ?? [];
  const detail = detailQuery.data;
  const allRoles = rolesQuery.data ?? [];
  const groupRoles = detail?.roles ?? [];

  const memberCandidates = useMemo(() => {
    const memberIds = new Set((detail?.members ?? []).map((m) => m.id));
    const q = memberSearch.trim().toLowerCase();
    return (usersQuery.data ?? []).filter((u) => {
      if (u.deactivatedAt || u.lockedAt) return false;
      if (memberIds.has(u.id)) return false;
      if (!q) return true;
      const hay = `${u.displayName} ${u.referenceId} ${u.email ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [usersQuery.data, detail?.members, memberSearch]);

  const availableRoles = allRoles.filter(
    (r) => !groupRoles.some((gr) => gr.id === r.id),
  );

  const openGroup = (g: GroupSummary) => {
    setSelectedId(g.id);
    setRenameName(g.name);
    setMemberSearch("");
    setActionError(null);
    setCreating(false);
    setDeleteConfirm(false);
  };

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Groups of users that can receive platform roles and be added to project
        Managers, Members, or Viewers. Assigning Administrator to a Group grants
        Administration access to its members. Empty Groups are allowed. Delete is
        permanent.
      </p>
      {groupsQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {groupsQuery.isError ? (
        <p className="error-text">{(groupsQuery.error as Error).message}</p>
      ) : null}
      {actionError ? <p className="error-text">{actionError}</p> : null}

      <div className="admin-toolbar">
        <button
          type="button"
          className="btn primary small"
          onClick={() => {
            setCreating(true);
            setSelectedId(null);
            setCreateError(null);
            setActionError(null);
          }}
        >
          Create group
        </button>
      </div>

      {creating ? (
        <div className="admin-form-card" role="dialog" aria-label="Create group">
          <h3 className="admin-form-card__title">Create group</h3>
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              autoComplete="off"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && createName.trim()) {
                  createMutation.mutate(createName.trim());
                }
              }}
            />
          </label>
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
              disabled={!createName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate(createName.trim())}
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
              <th>Group</th>
              <th>Members</th>
              <th>Roles</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr
                key={g.id}
                className={selectedId === g.id ? "is-selected" : undefined}
              >
                <td>
                  <strong>{g.name}</strong>
                  <div className="muted small">{g.referenceId}</div>
                </td>
                <td>{g.memberCount}</td>
                <td>
                  <div className="admin-role-chips">
                    {(g.roles ?? []).length === 0 ? (
                      <span className="muted small">No roles</span>
                    ) : (
                      (g.roles ?? []).map((role) => (
                        <span key={role.id} className="tag-chip">
                          <span className="tag-chip__name">{role.name}</span>
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="admin-table__actions">
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => openGroup(g)}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!groupsQuery.isLoading && groups.length === 0 ? (
        <p className="muted">No groups yet.</p>
      ) : null}

      {selectedId != null ? (
        <div className="admin-form-card" aria-label="Group detail">
          <h3 className="admin-form-card__title">
            {detail?.referenceId ?? "…"}
            {detail ? (
              <span className="muted small"> · {detail.memberCount} member(s)</span>
            ) : null}
          </h3>
          {detailQuery.isLoading ? <p className="muted">Loading detail…</p> : null}
          {detailQuery.isError ? (
            <p className="error-text">{(detailQuery.error as Error).message}</p>
          ) : null}

          {detail ? (
            <>
              <label className="field">
                <span>Name</span>
                <input
                  type="text"
                  autoComplete="off"
                  value={renameName}
                  onChange={(e) => setRenameName(e.target.value)}
                />
              </label>
              <div className="admin-form-card__actions">
                <button
                  type="button"
                  className="btn primary small"
                  disabled={
                    !renameName.trim() ||
                    renameName.trim() === detail.name ||
                    renameMutation.isPending
                  }
                  onClick={() =>
                    renameMutation.mutate({
                      id: detail.id,
                      name: renameName.trim(),
                    })
                  }
                >
                  Save name
                </button>
              </div>

              <h4 style={{ marginBottom: "0.35rem" }}>Roles</h4>
              <div className="admin-role-chips">
                {groupRoles.length === 0 ? (
                  <span className="muted small">No roles</span>
                ) : (
                  groupRoles.map((role) => (
                    <span key={role.id} className="tag-chip tag-chip--removable">
                      <span className="tag-chip__name">{role.name}</span>
                      <button
                        type="button"
                        className="tag-chip__remove"
                        disabled={removeRoleMutation.isPending}
                        title={`Remove ${role.name}`}
                        aria-label={`Remove ${role.name}`}
                        onClick={() =>
                          removeRoleMutation.mutate({
                            groupId: detail.id,
                            roleId: role.id,
                          })
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
                {availableRoles.length > 0 ? (
                  <select
                    className="admin-role-add"
                    aria-label={`Add role to ${detail.name}`}
                    defaultValue=""
                    disabled={assignRoleMutation.isPending}
                    onChange={(e) => {
                      const roleId = Number(e.target.value);
                      e.currentTarget.value = "";
                      if (Number.isFinite(roleId) && roleId > 0) {
                        assignRoleMutation.mutate({
                          groupId: detail.id,
                          roleId,
                        });
                      }
                    }}
                  >
                    <option value="">Add role…</option>
                    {availableRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {roleIsAdministrator(r) ? " (grants Administration)" : ""}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>

              <h4 style={{ marginBottom: "0.35rem", marginTop: "1rem" }}>Members</h4>
              {detail.members.length === 0 ? (
                <p className="muted small">No members yet.</p>
              ) : (
                <ul className="admin-role-list">
                  {detail.members.map((m) => (
                    <li key={m.id} className="admin-role-list__row">
                      <span>
                        {m.displayName}{" "}
                        <span className="muted small">{m.referenceId}</span>
                        {m.email ? (
                          <span className="muted small"> · {m.email}</span>
                        ) : null}
                      </span>
                      <span className="admin-role-list__actions">
                        <button
                          type="button"
                          className="btn ghost small"
                          disabled={removeMemberMutation.isPending}
                          onClick={() =>
                            removeMemberMutation.mutate({
                              groupId: detail.id,
                              userId: m.id,
                            })
                          }
                        >
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <label className="field" style={{ marginTop: "0.75rem" }}>
                <span>Add member</span>
                <input
                  type="search"
                  autoComplete="off"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Search active users…"
                />
              </label>
              {usersQuery.isLoading ? (
                <p className="muted small">Loading users…</p>
              ) : (
                <ul className="admin-role-list">
                  {memberCandidates.slice(0, 12).map((u) => (
                    <li key={u.id} className="admin-role-list__row">
                      <span>
                        {u.displayName}{" "}
                        <span className="muted small">{u.referenceId}</span>
                        {u.email ? (
                          <span className="muted small"> · {u.email}</span>
                        ) : null}
                      </span>
                      <span className="admin-role-list__actions">
                        <button
                          type="button"
                          className="btn primary small"
                          disabled={addMemberMutation.isPending}
                          onClick={() =>
                            addMemberMutation.mutate({
                              groupId: detail.id,
                              userId: u.id,
                            })
                          }
                        >
                          Add
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!usersQuery.isLoading &&
              memberSearch.trim() &&
              memberCandidates.length === 0 ? (
                <p className="muted small">No matching active users.</p>
              ) : null}

              <div className="admin-form-card__actions" style={{ marginTop: "1rem" }}>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => {
                    setSelectedId(null);
                    setDeleteConfirm(false);
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={deleteMutation.isPending}
                  onClick={() => setDeleteConfirm(true)}
                >
                  Delete group
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteConfirm && detail != null}
        title="Delete group?"
        message={
          detail
            ? `Delete ${detail.referenceId} (${detail.name})? Members, roles, and project links will be removed. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        confirmTone="danger"
        confirmDisabled={deleteMutation.isPending}
        onCancel={() => setDeleteConfirm(false)}
        onConfirm={() => {
          if (detail) deleteMutation.mutate(detail.id);
        }}
      />
    </div>
  );
}
