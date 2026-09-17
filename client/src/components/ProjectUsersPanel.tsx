import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiJson } from "../api/client";
import { ConfirmDialog } from "./ConfirmDialog";

export type ProjectUserRole = "manager" | "member" | "viewer";

type UserRef = {
  id: number;
  referenceId: string;
  displayName: string;
  email: string | null;
};

type ProjectUserEntry = UserRef & {
  role: ProjectUserRole;
  createdAt: string;
};

type ProjectUsersLists = {
  managers: ProjectUserEntry[];
  members: ProjectUserEntry[];
  viewers: ProjectUserEntry[];
  owner: UserRef;
};

type AdminUserRow = UserRef & {
  deactivatedAt: string | null;
  lockedAt: string | null;
  roles: { slug: string }[];
};

const ROLE_META: {
  role: ProjectUserRole;
  title: string;
  blurb: string;
  listKey: keyof Pick<ProjectUsersLists, "managers" | "members" | "viewers">;
}[] = [
  {
    role: "manager",
    title: "Managers",
    blurb: "Read/write + Settings (enforced in T0128). Owner is always an implicit Manager.",
    listKey: "managers",
  },
  {
    role: "member",
    title: "Members",
    blurb: "Read/write on project records (enforced in T0128).",
    listKey: "members",
  },
  {
    role: "viewer",
    title: "Viewers",
    blurb: "Read-only (enforced in T0128).",
    listKey: "viewers",
  },
];

type Props = {
  projectId: number;
};

export function ProjectUsersPanel({ projectId }: Props) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [addRole, setAddRole] = useState<ProjectUserRole | null>(null);
  const [search, setSearch] = useState("");
  const [pendingRemove, setPendingRemove] = useState<ProjectUserEntry | null>(null);

  const listsQuery = useQuery({
    queryKey: ["project-users", projectId],
    queryFn: async () => {
      const res = await apiJson<{ data: ProjectUsersLists }>(
        `/api/v1/projects/${projectId}/users`,
      );
      return res.data;
    },
  });

  const adminUsersQuery = useQuery({
    queryKey: ["admin-users"],
    enabled: addRole != null,
    queryFn: async () => {
      const res = await apiJson<{ data: AdminUserRow[] }>("/api/v1/admin/users");
      return res.data;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["project-users", projectId] });
  };

  const assignedIds = useMemo(() => {
    const data = listsQuery.data;
    if (!data) return new Set<number>();
    return new Set([
      data.owner.id,
      ...data.managers.map((u) => u.id),
      ...data.members.map((u) => u.id),
      ...data.viewers.map((u) => u.id),
    ]);
  }, [listsQuery.data]);

  const candidates = useMemo(() => {
    const users = adminUsersQuery.data ?? [];
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (u.deactivatedAt || u.lockedAt) return false;
      if (u.roles.some((r) => r.slug === "administrator")) return false;
      if (assignedIds.has(u.id)) return false;
      if (!q) return true;
      const hay = `${u.displayName} ${u.referenceId} ${u.email ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [adminUsersQuery.data, assignedIds, search]);

  const addUser = useMutation({
    mutationFn: async ({ userId, role }: { userId: number; role: ProjectUserRole }) => {
      await apiJson(`/api/v1/projects/${projectId}/users`, {
        method: "POST",
        body: JSON.stringify({ userId, role }),
      });
    },
    onSuccess: () => {
      setError(null);
      setAddRole(null);
      setSearch("");
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const removeUser = useMutation({
    mutationFn: async (userId: number) => {
      await apiJson(`/api/v1/projects/${projectId}/users/${userId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      setError(null);
      setPendingRemove(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const data = listsQuery.data;

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <h2 style={{ marginTop: 0 }}>Users</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Assign active users to Managers, Members, or Viewers. Until project Roles (T0128), these lists
        do not grant record access — only the owner and Administrators can open project records.
        Administrators are not listed (they already have full access).
      </p>

      {listsQuery.isLoading ? <p className="muted">Loading users…</p> : null}
      {listsQuery.isError ? (
        <p role="alert">{(listsQuery.error as Error).message}</p>
      ) : null}
      {error ? (
        <p role="alert" style={{ marginBottom: "0.75rem" }}>
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          <div className="project-users__owner" style={{ marginBottom: "1rem" }}>
            <strong>Owner (implicit Manager)</strong>
            <p style={{ margin: "0.25rem 0 0" }}>
              {data.owner.displayName}{" "}
              <span className="muted">{data.owner.referenceId}</span>
              {data.owner.email ? (
                <span className="muted"> · {data.owner.email}</span>
              ) : null}
            </p>
          </div>

          <div
            className="project-users__roles"
            style={{
              display: "grid",
              gap: "1rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            {ROLE_META.map((meta) => {
              const rows = data[meta.listKey];
              return (
                <section key={meta.role} className="project-users__role">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                      marginBottom: "0.35rem",
                    }}
                  >
                    <h3 style={{ margin: 0, fontSize: "1rem" }}>{meta.title}</h3>
                    <button
                      type="button"
                      className="btn small primary"
                      onClick={() => {
                        setError(null);
                        setSearch("");
                        setAddRole(meta.role);
                      }}
                    >
                      Add
                    </button>
                  </div>
                  <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
                    {meta.blurb}
                  </p>
                  {rows.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>
                      None yet
                    </p>
                  ) : (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {rows.map((u) => (
                        <li
                          key={u.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "0.5rem",
                            padding: "0.35rem 0",
                            borderTop: "1px solid var(--border, #333)",
                          }}
                        >
                          <span>
                            {u.displayName}{" "}
                            <span className="muted">{u.referenceId}</span>
                          </span>
                          <button
                            type="button"
                            className="btn small ghost"
                            aria-label={`Remove ${u.displayName} from ${meta.title}`}
                            onClick={() => {
                              setError(null);
                              setPendingRemove(u);
                            }}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      ) : null}

      {addRole ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-users-add-title"
          className="modal-backdrop"
          onMouseDown={() => {
            setAddRole(null);
            setSearch("");
          }}
        >
          <div
            className="modal"
            style={{ width: "min(420px, 100%)", maxHeight: "80vh", overflow: "auto" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="project-users-add-title" style={{ marginTop: 0 }}>
              Add to {ROLE_META.find((r) => r.role === addRole)?.title}
            </h2>
            <div className="field">
              <label htmlFor="project-users-search">Search users</label>
              <input
                id="project-users-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, U####, or email"
                autoFocus
              />
            </div>
            {adminUsersQuery.isLoading ? <p className="muted">Loading directory…</p> : null}
            {adminUsersQuery.isError ? (
              <p role="alert">{(adminUsersQuery.error as Error).message}</p>
            ) : null}
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {candidates.slice(0, 40).map((u) => (
                <li
                  key={u.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    padding: "0.4rem 0",
                    borderTop: "1px solid var(--border, #333)",
                  }}
                >
                  <span>
                    {u.displayName}{" "}
                    <span className="muted">{u.referenceId}</span>
                    {u.email ? <span className="muted"> · {u.email}</span> : null}
                  </span>
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={addUser.isPending}
                    onClick={() => addUser.mutate({ userId: u.id, role: addRole })}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
            {!adminUsersQuery.isLoading && candidates.length === 0 ? (
              <p className="muted">No matching active users available.</p>
            ) : null}
            <div className="modal-actions" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setAddRole(null);
                  setSearch("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingRemove != null}
        title="Remove user from project?"
        message={
          pendingRemove
            ? `Remove ${pendingRemove.displayName} (${pendingRemove.referenceId}) from ${pendingRemove.role}s? Reassignment of assigned records will arrive with T0128.`
            : ""
        }
        confirmLabel="Remove"
        confirmTone="danger"
        confirmDisabled={removeUser.isPending}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          if (pendingRemove) removeUser.mutate(pendingRemove.id);
        }}
      />
    </div>
  );
}
