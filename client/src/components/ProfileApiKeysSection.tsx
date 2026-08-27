import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../api/client";

type ProfileApiKey = {
  id: number;
  name: string;
  prefix: string;
  access: "readonly" | "readwrite";
  status: "active" | "suspended" | "expired" | "revoked";
  expiresAt: string;
  lastUsedAt: string | null;
};

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(local: string): string {
  const d = new Date(local);
  return d.toISOString();
}

export function ProfileApiKeysSection() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("Personal key");
  const [access, setAccess] = useState<"readonly" | "readwrite">("readwrite");
  const [rawOnce, setRawOnce] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editExpiry, setEditExpiry] = useState("");

  const keysQuery = useQuery({
    queryKey: ["users", "me", "api-keys"],
    queryFn: async () => {
      const res = await apiJson<{ data: ProfileApiKey[] }>("/api/v1/users/me/api-keys");
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: ProfileApiKey & { rawKey: string } }>(
        "/api/v1/users/me/api-keys",
        {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), access }),
        },
      );
      return res.data;
    },
    onSuccess: async (data) => {
      setRawOnce(data.rawKey);
      setCreating(false);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["users", "me", "api-keys"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const expiryMutation = useMutation({
    mutationFn: async ({ id, expiresAt }: { id: number; expiresAt: string }) => {
      await apiJson(`/api/v1/users/me/api-keys/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ expiresAt }),
      });
    },
    onSuccess: async () => {
      setEditingId(null);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["users", "me", "api-keys"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/users/me/api-keys/${id}`, { method: "DELETE" });
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["users", "me", "api-keys"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiJson(`/api/v1/users/me/api-keys/${id}?purge=1`, { method: "DELETE" });
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["users", "me", "api-keys"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const keys = keysQuery.data ?? [];
  const activeCount = keys.filter((k) => k.status === "active").length;

  return (
    <div className="profile-settings__section">
      <h3 className="profile-settings__heading">API keys</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        Up to 3 active keys. Use <code>Authorization: Bearer</code> or{" "}
        <code>X-API-Key</code>. Secrets are shown once at creation and cannot be retrieved
        again.
      </p>

      {rawOnce ? (
        <div className="admin-form-card admin-form-card--warn">
          <h4 className="admin-form-card__title">Copy your key now</h4>
          <p className="muted small">
            This secret will not be shown again. Store it somewhere safe before closing.
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

      <div className="profile-settings__actions" style={{ marginBottom: "0.75rem" }}>
        <button
          type="button"
          className="btn primary small"
          disabled={activeCount >= 3 || creating}
          onClick={() => {
            setCreating(true);
            setError(null);
          }}
        >
          Create key
        </button>
        <span className="muted small">{activeCount}/3 active</span>
      </div>

      {creating ? (
        <div className="admin-form-card">
          <h4 className="admin-form-card__title">Create API key</h4>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
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

      {keysQuery.isLoading ? <p className="muted">Loading keys…</p> : null}
      {keys.length === 0 && !keysQuery.isLoading ? (
        <p className="muted small">No API keys yet.</p>
      ) : null}

      <ul className="profile-api-keys">
        {keys.map((k) => (
          <li key={k.id} className="profile-api-keys__row">
            <div>
              <strong>{k.name}</strong>{" "}
              <code className="muted">{k.prefix}…</code>
              <div className="muted small">
                {k.access === "readonly" ? "RO" : "RW"} · {k.status} · expires{" "}
                {new Date(k.expiresAt).toLocaleString()}
                {k.lastUsedAt
                  ? ` · last used ${new Date(k.lastUsedAt).toLocaleString()}`
                  : ""}
              </div>
            </div>
            <div className="profile-api-keys__actions">
              {k.status === "active" || k.status === "suspended" ? (
                editingId === k.id ? (
                  <>
                    <input
                      type="datetime-local"
                      value={editExpiry}
                      onChange={(e) => setEditExpiry(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn primary small"
                      disabled={expiryMutation.isPending || !editExpiry}
                      onClick={() =>
                        expiryMutation.mutate({
                          id: k.id,
                          expiresAt: fromDatetimeLocalValue(editExpiry),
                        })
                      }
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => {
                      setEditingId(k.id);
                      setEditExpiry(toDatetimeLocalValue(k.expiresAt));
                      setError(null);
                    }}
                  >
                    Update expiry
                  </button>
                )
              ) : null}
              {k.status === "active" || k.status === "suspended" ? (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Revoke this API key permanently? It cannot be used again.",
                      )
                    ) {
                      revokeMutation.mutate(k.id);
                    }
                  }}
                >
                  Revoke
                </button>
              ) : null}
              {k.status === "revoked" || k.status === "expired" ? (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete this ${k.status} API key from your list? This cannot be undone.`,
                      )
                    ) {
                      deleteMutation.mutate(k.id);
                    }
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
