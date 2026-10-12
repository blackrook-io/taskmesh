import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";
import { ConfirmDialog } from "../ConfirmDialog";

type Capabilities = {
  chat: boolean;
  streaming: boolean;
  tools: boolean;
  embeddings: boolean;
  local: boolean;
};

type AiKeyMode = "instance_only" | "user_only" | "user_preferred_instance_fallback";

type AiProviderRow = {
  id: string;
  displayName: string;
  version: string;
  enabled: boolean;
  configured: boolean;
  capabilities: Capabilities;
  config: {
    baseUrl: string;
    defaultModel: string;
    chatDeployment: string;
    embeddingsDeployment: string;
    apiVersion: string;
  };
  keyHint: string | null;
  keyVerifiedAt: string | null;
};

type ProvidersPayload = {
  plugins: AiProviderRow[];
  keyMode: AiKeyMode;
  activeUserCount: number;
};

type Draft = {
  enabled: boolean;
  baseUrl: string;
  defaultModel: string;
  chatDeployment: string;
  embeddingsDeployment: string;
  apiVersion: string;
};

const BILLING_RISK_PHRASE = "I understand and accept";

const KEY_MODE_OPTIONS: Array<{ value: AiKeyMode; label: string }> = [
  { value: "instance_only", label: "Instance only" },
  { value: "user_only", label: "User only" },
  { value: "user_preferred_instance_fallback", label: "User preferred, instance fallback" },
];

function emptyDraft(): Draft {
  return {
    enabled: false,
    baseUrl: "",
    defaultModel: "",
    chatDeployment: "",
    embeddingsDeployment: "",
    apiVersion: "",
  };
}

function capabilityLine(capabilities: Capabilities): string {
  const on = (Object.entries(capabilities) as Array<[keyof Capabilities, boolean]>)
    .filter(([, value]) => value)
    .map(([name]) => name);
  return on.join(", ");
}

function needsBillingAck(current: AiKeyMode, next: AiKeyMode, activeUserCount: number): boolean {
  if (next === current || next === "user_only") return false;
  return activeUserCount > 1;
}

export function AdminAiProvidersSection() {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<AiKeyMode | null>(null);
  const [phrase, setPhrase] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin", "ai-providers"],
    queryFn: async () => {
      const res = await apiJson<{ data: ProvidersPayload }>("/api/v1/admin/ai-providers");
      return res.data;
    },
  });

  const [prevPlugins, setPrevPlugins] = useState(query.data?.plugins);
  if (query.data?.plugins !== prevPlugins) {
    setPrevPlugins(query.data?.plugins);
    if (query.data) {
      const next: Record<string, Draft> = {};
      for (const plugin of query.data.plugins) {
        next[plugin.id] = {
          ...emptyDraft(),
          enabled: plugin.enabled,
          baseUrl: plugin.config.baseUrl,
          defaultModel: plugin.config.defaultModel,
          chatDeployment: plugin.config.chatDeployment,
          embeddingsDeployment: plugin.config.embeddingsDeployment,
          apiVersion: plugin.config.apiVersion,
        };
      }
      setDrafts(next);
    }
  }

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["admin", "ai-providers"] });
    await qc.invalidateQueries({ queryKey: ["assistant-status"] });
  }

  const saveMutation = useMutation({
    mutationFn: async (id: string) => {
      const draft = drafts[id];
      if (!draft) throw new Error("Missing provider draft");
      const res = await apiJson<{ data: AiProviderRow }>("/api/v1/admin/ai-providers", {
        method: "PATCH",
        body: JSON.stringify({
          id,
          enabled: draft.enabled,
          config:
            id === "azure-openai"
              ? {
                  baseUrl: draft.baseUrl,
                  chatDeployment: draft.chatDeployment,
                  embeddingsDeployment: draft.embeddingsDeployment,
                  apiVersion: draft.apiVersion,
                }
              : { baseUrl: draft.baseUrl, defaultModel: draft.defaultModel },
        }),
      });
      return res.data;
    },
    onSuccess: async (row) => {
      setError(null);
      setSavedId(row.id);
      await refresh();
      window.setTimeout(() => setSavedId((current) => (current === row.id ? null : current)), 2000);
    },
    onError: (err: Error) => setError(err.message),
  });

  const keyMutation = useMutation({
    mutationFn: async (args: { id: string; apiKey: string }) => {
      const res = await apiJson<{ data: { keyHint: string | null } }>(
        `/api/v1/admin/ai-providers/${args.id}/key`,
        { method: "PUT", body: JSON.stringify({ apiKey: args.apiKey }) },
      );
      return { id: args.id, hint: res.data.keyHint };
    },
    onSuccess: async (row) => {
      setError(null);
      setKeyDrafts((current) => ({ ...current, [row.id]: "" }));
      setSavedId(row.id);
      await refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiJson(`/api/v1/admin/ai-providers/${id}/key`, { method: "DELETE" });
      return id;
    },
    onSuccess: async () => {
      setError(null);
      setRemoveId(null);
      await refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const verifyMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiJson(`/api/v1/admin/ai-providers/${id}/key/verify`, { method: "POST" });
      return id;
    },
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const modeMutation = useMutation({
    mutationFn: async (args: { mode: AiKeyMode; acknowledgement?: string }) => {
      const res = await apiJson<{ data: { mode: AiKeyMode; activeUserCount: number } }>(
        "/api/v1/admin/ai-key-mode",
        { method: "PATCH", body: JSON.stringify(args) },
      );
      return res.data;
    },
    onSuccess: async () => {
      setError(null);
      setPendingMode(null);
      setPhrase("");
      await refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  function update(id: string, patch: Partial<Draft>) {
    setDrafts((current) => {
      const prev = current[id];
      if (!prev) return current;
      return { ...current, [id]: { ...prev, ...patch } };
    });
  }

  function chooseMode(next: AiKeyMode) {
    const current = query.data?.keyMode;
    const activeUserCount = query.data?.activeUserCount ?? 0;
    if (!current || next === current) return;
    if (needsBillingAck(current, next, activeUserCount)) {
      setPendingMode(next);
      setPhrase("");
      setError(null);
      return;
    }
    modeMutation.mutate({ mode: next });
  }

  const activeUserCount = query.data?.activeUserCount ?? 0;
  const removePlugin = query.data?.plugins.find((plugin) => plugin.id === removeId) ?? null;

  return (
    <section style={{ marginTop: "1.75rem" }}>
      <h2>AI providers</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Enable a provider, set its connection, and store an instance key. The key is encrypted on
        the server. This page shows only the last 4 characters. A stored instance key is used
        before the deprecated environment variable.
      </p>
      {query.isLoading ? <p className="muted">Loading…</p> : null}
      {query.isError ? <p role="alert">{(query.error as Error).message}</p> : null}
      {query.data ? (
        <div className="card" style={{ marginTop: "0.75rem" }}>
          <h3 style={{ marginTop: 0 }}>Key mode</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Active users: {activeUserCount}. User only never spends the instance key. The other
            modes spend it for users who do not have their own key, including background features.
            {activeUserCount > 1
              ? " Switching into those modes asks you to type a confirmation."
              : ""}
          </p>
          <label className="field">
            <span>Who can use the instance key</span>
            <select
              value={query.data.keyMode}
              onChange={(e) => chooseMode(e.target.value as AiKeyMode)}
              disabled={modeMutation.isPending}
            >
              {KEY_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {query.data?.plugins.length === 0 ? <p className="muted">No provider plugins are loaded.</p> : null}
      {query.data?.plugins.map((plugin) => {
        const draft = drafts[plugin.id];
        if (!draft) return null;
        const usesKey = !plugin.capabilities.local;
        return (
          <div key={plugin.id} className="card" style={{ marginTop: "0.75rem" }}>
            <h3 style={{ marginTop: 0 }}>
              {plugin.displayName} <code>{plugin.version}</code>
            </h3>
            <p className="muted small" style={{ marginTop: 0 }}>
              {capabilityLine(plugin.capabilities)}
              {plugin.configured ? " · key present" : " · no key"}
              {plugin.keyHint ? ` · ends in ${plugin.keyHint}` : ""}
              {plugin.keyVerifiedAt ? " · verified" : ""}
            </p>
            <label className="field" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => update(plugin.id, { enabled: e.target.checked })}
              />
              <span>Enabled</span>
            </label>
            {plugin.id === "azure-openai" ? (
              <>
                <label className="field">
                  <span>Endpoint</span>
                  <input
                    value={draft.baseUrl}
                    onChange={(e) => update(plugin.id, { baseUrl: e.target.value })}
                    spellCheck={false}
                    placeholder="https://my-resource.openai.azure.com"
                  />
                </label>
                <label className="field">
                  <span>Chat deployment</span>
                  <input
                    value={draft.chatDeployment}
                    onChange={(e) => update(plugin.id, { chatDeployment: e.target.value })}
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span>Embeddings deployment</span>
                  <input
                    value={draft.embeddingsDeployment}
                    onChange={(e) => update(plugin.id, { embeddingsDeployment: e.target.value })}
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span>API version</span>
                  <input
                    value={draft.apiVersion}
                    onChange={(e) => update(plugin.id, { apiVersion: e.target.value })}
                    spellCheck={false}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span>Base URL</span>
                  <input
                    value={draft.baseUrl}
                    onChange={(e) => update(plugin.id, { baseUrl: e.target.value })}
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span>Default model</span>
                  <input
                    value={draft.defaultModel}
                    onChange={(e) => update(plugin.id, { defaultModel: e.target.value })}
                    spellCheck={false}
                  />
                </label>
              </>
            )}
            <button
              type="button"
              className="btn primary small"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(plugin.id)}
            >
              Save {plugin.displayName}
            </button>
            {savedId === plugin.id ? <p className="ok-text">Saved.</p> : null}
            {usesKey ? (
              <div style={{ marginTop: "0.75rem" }}>
                <label className="field">
                  <span>Instance key</span>
                  <input
                    type="password"
                    value={keyDrafts[plugin.id] ?? ""}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) =>
                      setKeyDrafts((current) => ({ ...current, [plugin.id]: e.target.value }))
                    }
                  />
                </label>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn small"
                    disabled={keyMutation.isPending || !(keyDrafts[plugin.id] ?? "").trim()}
                    onClick={() =>
                      keyMutation.mutate({ id: plugin.id, apiKey: keyDrafts[plugin.id] ?? "" })
                    }
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    disabled={verifyMutation.isPending || !plugin.keyHint}
                    onClick={() => verifyMutation.mutate(plugin.id)}
                  >
                    Verify
                  </button>
                  <button
                    type="button"
                    className="btn small danger"
                    disabled={removeMutation.isPending || !plugin.keyHint}
                    onClick={() => setRemoveId(plugin.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="error-text">{error}</p> : null}
      {pendingMode ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            setPendingMode(null);
            setPhrase("");
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="billing-risk-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="billing-risk-title">Instance key billing</h2>
            <p>
              This mode spends the instance key for every user who does not have their own key,
              including background features run for them.
            </p>
            <p>
              Active users: <strong>{activeUserCount}</strong>. No instance-key spend cap is
              configured yet.
            </p>
            <label className="field">
              <span>
                Type <code>{BILLING_RISK_PHRASE}</code>
              </span>
              <input
                value={phrase}
                autoComplete="off"
                onChange={(e) => setPhrase(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn primary"
                disabled={modeMutation.isPending || phrase.trim() !== BILLING_RISK_PHRASE}
                onClick={() =>
                  modeMutation.mutate({ mode: pendingMode, acknowledgement: phrase.trim() })
                }
              >
                Confirm
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setPendingMode(null);
                  setPhrase("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={removeId != null}
        title="Remove instance key"
        message={
          removePlugin
            ? `Remove the stored instance key for ${removePlugin.displayName}? The last-4 hint will disappear.`
            : "Remove this instance key?"
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (removeId) removeMutation.mutate(removeId);
        }}
        onCancel={() => setRemoveId(null)}
      />
    </section>
  );
}
