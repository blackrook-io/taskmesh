import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";

type AdminApiKey = {
  id: number;
  name: string;
  prefix: string;
  access: "readonly" | "readwrite";
  status: "active" | "suspended" | "expired" | "revoked";
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
  owner: { id: number; referenceId: string; displayName: string };
  rawKey?: string;
};

export function AdminKeysPanel() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("Default key");
  const [access, setAccess] = useState<"readonly" | "readwrite">("readwrite");
  const [rawOnce, setRawOnce] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ["admin", "api-keys"],
    queryFn: async () => {
      const res = await apiJson<{ data: AdminApiKey[] }>("/api/v1/admin/api-keys");
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: AdminApiKey & { rawKey: string } }>(
        "/api/v1/admin/api-keys",
        {
          method: "POST",
          body: JSON.stringify({ name, access }),
        },
      );
      return res.data;
    },
    onSuccess: async (data) => {
      setRawOnce(data.rawKey);
      setCreating(false);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "api-keys"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const actionMutation = useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: number;
      action: "suspend" | "unsuspend" | "expire" | "revoke";
    }) => {
      await apiJson(`/api/v1/admin/api-keys/${id}/${action}`, { method: "POST" });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "api-keys"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const keys = keysQuery.data ?? [];

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        All API keys in the system. Full request enforcement lands with T0063; this panel
        manages key records and states.
      </p>

      <div className="admin-toolbar">
        <button
          type="button"
          className="btn primary small"
          onClick={() => {
            setCreating(true);
            setError(null);
          }}
        >
          Create key
        </button>
      </div>

      {rawOnce ? (
        <div className="admin-form-card admin-form-card--warn">
          <h3 className="admin-form-card__title">Copy your key now</h3>
          <p className="muted small">
            This secret is shown once and cannot be retrieved again.
          </p>
          <code className="admin-raw-key">{rawOnce}</code>
          <div className="admin-form-card__actions">
            <button
              type="button"
              className="btn ghost small"
              onClick={() => void navigator.clipboard.writeText(rawOnce)}
            >
              Copy
            </button>
            <button type="button" className="btn small" onClick={() => setRawOnce(null)}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      {creating ? (
        <div className="admin-form-card">
          <h3 className="admin-form-card__title">Create API key</h3>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Access</span>
            <select
              value={access}
              onChange={(e) => setAccess(e.target.value as "readonly" | "readwrite")}
            >
              <option value="readwrite">Read / Write</option>
              <option value="readonly">Read only</option>
            </select>
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="admin-form-card__actions">
            <button type="button" className="btn ghost small" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary small"
              disabled={createMutation.isPending || !name.trim()}
              onClick={() => createMutation.mutate()}
            >
              Create
            </button>
          </div>
        </div>
      ) : null}

      {error && !creating ? <p className="error-text">{error}</p> : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Owner</th>
              <th>Access</th>
              <th>Status</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No API keys yet.
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>
                    <code>{k.prefix}…</code>
                  </td>
                  <td>{k.owner.referenceId}</td>
                  <td>{k.access === "readonly" ? "RO" : "RW"}</td>
                  <td>
                    <span className={`admin-badge admin-badge--${k.status}`}>{k.status}</span>
                  </td>
                  <td className="muted small">
                    {new Date(k.expiresAt).toLocaleString()}
                  </td>
                  <td className="admin-table__actions">
                    {k.status === "active" ? (
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => {
                          if (window.confirm("Suspend this key?")) {
                            actionMutation.mutate({ id: k.id, action: "suspend" });
                          }
                        }}
                      >
                        Suspend
                      </button>
                    ) : null}
                    {k.status === "suspended" ? (
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() =>
                          actionMutation.mutate({ id: k.id, action: "unsuspend" })
                        }
                      >
                        Unsuspend
                      </button>
                    ) : null}
                    {k.status === "active" || k.status === "suspended" ? (
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => {
                          if (window.confirm("Force-expire this key?")) {
                            actionMutation.mutate({ id: k.id, action: "expire" });
                          }
                        }}
                      >
                        Expire
                      </button>
                    ) : null}
                    {k.status !== "revoked" ? (
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => {
                          if (window.confirm("Revoke this key permanently?")) {
                            actionMutation.mutate({ id: k.id, action: "revoke" });
                          }
                        }}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
