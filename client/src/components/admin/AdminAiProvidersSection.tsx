import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";

type Capabilities = {
  chat: boolean;
  streaming: boolean;
  tools: boolean;
  embeddings: boolean;
  local: boolean;
};

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
};

type Draft = {
  enabled: boolean;
  baseUrl: string;
  defaultModel: string;
  chatDeployment: string;
  embeddingsDeployment: string;
  apiVersion: string;
};

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

export function AdminAiProvidersSection() {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin", "ai-providers"],
    queryFn: async () => {
      const res = await apiJson<{ data: { plugins: AiProviderRow[] } }>("/api/v1/admin/ai-providers");
      return res.data.plugins;
    },
  });

  const [prevPlugins, setPrevPlugins] = useState(query.data);
  if (query.data !== prevPlugins) {
    setPrevPlugins(query.data);
    if (query.data) {
      const next: Record<string, Draft> = {};
      for (const plugin of query.data) {
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
      await qc.invalidateQueries({ queryKey: ["admin", "ai-providers"] });
      await qc.invalidateQueries({ queryKey: ["assistant-status"] });
      window.setTimeout(() => setSavedId((current) => (current === row.id ? null : current)), 2000);
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

  return (
    <section style={{ marginTop: "1.75rem" }}>
      <h2>AI providers</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Enable a provider and set its connection settings. API keys are not stored here. The OpenAI
        plugin still reads <code>OPENAI_API_KEY</code> until instance keys are available.
      </p>
      {query.isLoading ? <p className="muted">Loading…</p> : null}
      {query.isError ? <p role="alert">{(query.error as Error).message}</p> : null}
      {query.data?.length === 0 ? <p className="muted">No provider plugins are loaded.</p> : null}
      {query.data?.map((plugin) => {
        const draft = drafts[plugin.id];
        if (!draft) return null;
        return (
          <div key={plugin.id} className="card" style={{ marginTop: "0.75rem" }}>
            <h3 style={{ marginTop: 0 }}>
              {plugin.displayName} <code>{plugin.version}</code>
            </h3>
            <p className="muted small" style={{ marginTop: 0 }}>
              {capabilityLine(plugin.capabilities)}
              {plugin.configured ? " · key present" : " · no key"}
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
          </div>
        );
      })}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
