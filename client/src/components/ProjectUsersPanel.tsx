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

type AssignmentSummary = {
  taskCount: number;
  todoCount: number;
  total: number;
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
    blurb: "Read/write + Project Settings. Owner is always an implicit Manager.",
    listKey: "managers",
  },
  {
    role: "member",
    title: "Members",
    blurb: "Read/write on project records. No Settings access.",
    listKey: "members",
  },
  {
    role: "viewer",
    title: "Viewers",
    blurb: "Read-only access to project records.",
    listKey: "viewers",
  },
];

type Props = {
  projectId: number;
};

type RemoveFlow =
  | { kind: "confirm"; user: ProjectUserEntry }
  | {
      kind: "disposition";
      user: ProjectUserEntry;
      summary: AssignmentSummary;
      mode: "reassign" | "blank";
      reassignToUserId: number | null;
    };

export function ProjectUsersPanel({ projectId }: Props) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [addRole, setAddRole] = useState<ProjectUserRole | null>(null);
  const [search, setSearch] = useState("");
  const [removeFlow, setRemoveFlow] = useState<RemoveFlow | null>(null);

  const listsQuery = useQuery({
    queryKey: ["project-users", projectId],
    queryFn: async () => {
      const res = await apiJson<{ data: ProjectUsersLists }>(
        `/api/v1/projects/${projectId}/users`,
      );
      return res.data;
    },
  });

  const directoryQuery = useQuery({
    queryKey: ["project-directory-users", projectId],
    enabled: addRole != null,
    queryFn: async () => {
      const res = await apiJson<{ data: UserRef[] }>(
        `/api/v1/projects/${projectId}/users/directory`,
      );
      return res.data;
    },
  });

  const assignableQuery = useQuery({
    queryKey: ["assignable-users", projectId],
    enabled: removeFlow?.kind === "disposition",
    queryFn: async () => {
      const res = await apiJson<{ data: UserRef[] }>(
        `/api/v1/projects/${projectId}/assignable-users`,
      );
      return res.data;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["project-users", projectId] });
    void qc.invalidateQueries({ queryKey: ["project-directory-users", projectId] });
    void qc.invalidateQueries({ queryKey: ["assignable-users", projectId] });
    void qc.invalidateQueries({ queryKey: ["tasks", projectId] });
  };

  const candidates = useMemo(() => {
    const users = directoryQuery.data ?? [];
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (!q) return true;
      const hay = `${u.displayName} ${u.referenceId} ${u.email ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [directoryQuery.data, search]);

  const reassignCandidates = useMemo(() => {
    if (removeFlow?.kind !== "disposition") return [];
    const removedId = removeFlow.user.id;
    return (assignableQuery.data ?? []).filter((u) => u.id !== removedId);
  }, [assignableQuery.data, removeFlow]);

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
    mutationFn: async (args: {
      userId: number;
      disposition?: "blank" | "reassign";
      reassignToUserId?: number;
    }) => {
      const body =
        args.disposition != null
          ? {
              disposition: args.disposition,
              ...(args.disposition === "reassign"
                ? { reassignToUserId: args.reassignToUserId }
                : {}),
            }
          : undefined;
      await apiJson(`/api/v1/projects/${projectId}/users/${args.userId}`, {
        method: "DELETE",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    },
    onSuccess: () => {
      setError(null);
      setRemoveFlow(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const beginRemove = async (user: ProjectUserEntry) => {
    setError(null);
    if (user.role === "viewer") {
      setRemoveFlow({ kind: "confirm", user });
      return;
    }
    try {
      const res = await apiJson<{ data: AssignmentSummary }>(
        `/api/v1/projects/${projectId}/users/${user.id}/assignments`,
      );
      if (res.data.total > 0) {
        setRemoveFlow({
          kind: "disposition",
          user,
          summary: res.data,
          mode: "reassign",
          reassignToUserId: null,
        });
      } else {
        setRemoveFlow({ kind: "confirm", user });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check assignments");
    }
  };

  const data = listsQuery.data;

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <h2 style={{ marginTop: 0 }}>Users</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Assign active users to Managers, Members, or Viewers. Role lists grant project access.
        Administrators are not listed (they already have full access). The owner is an implicit
        Manager.
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
                            onClick={() => void beginRemove(u)}
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
            {directoryQuery.isLoading ? <p className="muted">Loading directory…</p> : null}
            {directoryQuery.isError ? (
              <p role="alert">{(directoryQuery.error as Error).message}</p>
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
            {!directoryQuery.isLoading && candidates.length === 0 ? (
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

      {removeFlow?.kind === "disposition" ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-users-disposition-title"
          className="modal-backdrop"
          onMouseDown={() => setRemoveFlow(null)}
        >
          <div
            className="modal"
            style={{ width: "min(460px, 100%)" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="project-users-disposition-title" style={{ marginTop: 0 }}>
              Reassign or clear assignments?
            </h2>
            <p>
              {removeFlow.user.displayName} is assigned to {removeFlow.summary.total} task(s)/todo(s)
              ({removeFlow.summary.taskCount} tasks, {removeFlow.summary.todoCount} todos). Choose how
              to handle those before removing them from {removeFlow.user.role}s.
            </p>
            <fieldset className="field" style={{ border: "none", padding: 0, margin: "0 0 1rem" }}>
              <legend className="muted" style={{ padding: 0 }}>
                Disposition
              </legend>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="radio"
                  name="disposition"
                  checked={removeFlow.mode === "reassign"}
                  onChange={() =>
                    setRemoveFlow({ ...removeFlow, mode: "reassign", reassignToUserId: null })
                  }
                />
                Reassign to another Owner, Manager, or Member
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.35rem" }}>
                <input
                  type="radio"
                  name="disposition"
                  checked={removeFlow.mode === "blank"}
                  onChange={() =>
                    setRemoveFlow({ ...removeFlow, mode: "blank", reassignToUserId: null })
                  }
                />
                Clear assignee (leave unassigned)
              </label>
            </fieldset>
            {removeFlow.mode === "reassign" ? (
              <div className="field">
                <label htmlFor="project-users-reassign">Reassign to</label>
                <select
                  id="project-users-reassign"
                  value={removeFlow.reassignToUserId ?? ""}
                  onChange={(e) =>
                    setRemoveFlow({
                      ...removeFlow,
                      reassignToUserId: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">Select user…</option>
                  {reassignCandidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName} ({u.referenceId})
                    </option>
                  ))}
                </select>
                {assignableQuery.isLoading ? <p className="muted">Loading assignable users…</p> : null}
              </div>
            ) : null}
            <div className="modal-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="btn ghost" onClick={() => setRemoveFlow(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={
                  removeUser.isPending ||
                  (removeFlow.mode === "reassign" && removeFlow.reassignToUserId == null)
                }
                onClick={() => {
                  if (removeFlow.mode === "blank") {
                    removeUser.mutate({
                      userId: removeFlow.user.id,
                      disposition: "blank",
                    });
                  } else if (removeFlow.reassignToUserId != null) {
                    removeUser.mutate({
                      userId: removeFlow.user.id,
                      disposition: "reassign",
                      reassignToUserId: removeFlow.reassignToUserId,
                    });
                  }
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={removeFlow?.kind === "confirm"}
        title="Remove user from project?"
        message={
          removeFlow?.kind === "confirm"
            ? `Remove ${removeFlow.user.displayName} (${removeFlow.user.referenceId}) from ${removeFlow.user.role}s?`
            : ""
        }
        confirmLabel="Remove"
        confirmTone="danger"
        confirmDisabled={removeUser.isPending}
        onCancel={() => setRemoveFlow(null)}
        onConfirm={() => {
          if (removeFlow?.kind === "confirm") {
            removeUser.mutate({ userId: removeFlow.user.id });
          }
        }}
      />
    </div>
  );
}
