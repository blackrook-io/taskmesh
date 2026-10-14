import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchAssistantStatus, type AssistantPluginStatus } from "../api/assistant";
import { apiJson } from "../api/client";
import { patchTier1OptIn } from "../api/aiActivity";
import { fetchUserAiUsage, formatUsdFromMicro } from "../api/aiUsage";
import {
  deleteUserAiCredential,
  fetchAiRouting,
  fetchUserAiCredentials,
  fetchUserAiPolicy,
  putAiRoute,
  putUserAiCredential,
  putUserAiPolicy,
  recommendedRoute,
  type AiRoutingFeature,
  type UserAiCredential,
  type UserAiPolicyView,
} from "../api/aiUserSettings";
import {
  AI_POLICY_ACTIONS,
  AI_POLICY_FLOOR,
  AI_POLICY_RECORD_TYPES,
  aiPolicyCellKey,
  type AiTier,
} from "../lib/aiPolicyMatrix";
import { AI_INSTRUCTIONS_MAX } from "../lib/aiInstructions";
import { useSettings } from "../lib/settings";
import type { UserProfile } from "../types";

type Props = {
  embedded?: boolean;
};

type CellChoice = "inherit" | "off" | "0" | "1" | "2" | "3";

type PolicyDraft = {
  cells: Record<string, CellChoice>;
  featuresOff: string[];
};

function isTier(value: unknown): value is AiTier {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function ceilingTier(policy: UserAiPolicyView, key: string): AiTier {
  const stored = policy.ceiling.matrix[key];
  if (isTier(stored)) return stored;
  const action = key.split(":")[0] ?? key;
  const actionTier = policy.ceiling.matrix[action];
  if (isTier(actionTier)) return actionTier;
  return AI_POLICY_ACTIONS.find((row) => row.id === action)?.tier ?? 3;
}

function choiceFor(policy: UserAiPolicyView, key: string): CellChoice {
  if (policy.off.includes(key)) return "off";
  const raised = policy.raised[key];
  if (isTier(raised) && raised > ceilingTier(policy, key)) return String(raised) as CellChoice;
  return "inherit";
}

function draftFromPolicy(policy: UserAiPolicyView): PolicyDraft {
  const cells: Record<string, CellChoice> = {};
  for (const action of AI_POLICY_ACTIONS) {
    cells[action.id] = choiceFor(policy, action.id);
    for (const recordType of AI_POLICY_RECORD_TYPES) {
      const key = aiPolicyCellKey(action.id, recordType.id);
      cells[key] = choiceFor(policy, key);
    }
  }
  const featuresOff = new Set(policy.featuresOff);
  for (const feature of policy.features) {
    if (feature.locked) featuresOff.add(feature.id);
  }
  return { cells, featuresOff: [...featuresOff] };
}

function draftToBody(policy: UserAiPolicyView, draft: PolicyDraft): {
  raised: Record<string, AiTier>;
  off: string[];
  featuresOff: string[];
} {
  const locked = new Set(policy.locked);
  const raised: Record<string, AiTier> = {};
  const off: string[] = [];
  for (const [key, choice] of Object.entries(draft.cells)) {
    if (locked.has(key)) continue;
    if (choice === "off") off.push(key);
    else if (choice !== "inherit") {
      const tier = Number(choice);
      if (isTier(tier) && tier > ceilingTier(policy, key)) raised[key] = tier;
    }
  }
  return { raised, off, featuresOff: draft.featuresOff };
}

function featureLabel(id: string): string {
  if (id === "assistant") return "Assistant";
  if (id === "capture") return "Capture";
  return id;
}

export function AssistantSettingsPage({ embedded = false }: Props) {
  const queryClient = useQueryClient();
  const { setSection } = useSettings();
  const statusQuery = useQuery({ queryKey: ["assistant-status"], queryFn: fetchAssistantStatus });
  const usageQuery = useQuery({ queryKey: ["ai-usage"], queryFn: fetchUserAiUsage });
  const credentialsQuery = useQuery({ queryKey: ["ai-credentials"], queryFn: fetchUserAiCredentials });
  const routingQuery = useQuery({ queryKey: ["ai-routing"], queryFn: fetchAiRouting });
  const policyQuery = useQuery({ queryKey: ["ai-policy"], queryFn: fetchUserAiPolicy });
  const profileQuery = useQuery({
    queryKey: ["users", "me"],
    queryFn: async () => {
      const res = await apiJson<{ data: UserProfile }>("/api/v1/users/me");
      return res.data;
    },
  });
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(null);
  const [instructions, setInstructions] = useState("");
  const [prevInstructions, setPrevInstructions] = useState<string | null | undefined>(undefined);
  if (profileQuery.data && profileQuery.data.aiInstructions !== prevInstructions) {
    setPrevInstructions(profileQuery.data.aiInstructions ?? null);
    setInstructions(profileQuery.data.aiInstructions ?? "");
  }

  const optIn = useMutation({
    mutationFn: patchTier1OptIn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["assistant-status"] });
    },
  });
  const saveInstructions = useMutation({
    mutationFn: async () => {
      const res = await apiJson<{ data: UserProfile }>("/api/v1/users/me", {
        method: "PATCH",
        body: JSON.stringify({ aiInstructions: instructions }),
      });
      return res.data;
    },
    onSuccess: async (saved) => {
      setPrevInstructions(saved.aiInstructions ?? null);
      setInstructions(saved.aiInstructions ?? "");
      await queryClient.invalidateQueries({ queryKey: ["users", "me"] });
    },
  });
  const savePolicy = useMutation({
    mutationFn: putUserAiPolicy,
    onSuccess: async () => {
      setPolicyDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["ai-policy"] });
      await queryClient.invalidateQueries({ queryKey: ["ai-capabilities"] });
    },
  });

  const data = statusQuery.data;
  const policy = policyQuery.data;
  const draft = policy && (policyDraft ?? draftFromPolicy(policy));
  const cloudPlugins = (data?.plugins ?? []).filter(
    (plugin) => plugin.enabled && plugin.capabilities.local !== true,
  );

  return (
    <div className={embedded ? "settings-panel" : undefined}>
      {embedded ? null : (
        <div className="page-head">
          <h1>Your AI</h1>
        </div>
      )}
      {embedded ? <h2 style={{ marginTop: 0 }}>Your AI</h2> : null}
      <p className="muted" style={{ marginTop: 0 }}>
        Your keys, models, and limits. You can only narrow what an Administrator allows.
      </p>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Your AI instructions</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Personal rules included when AI builds context for you. Instance and project instructions
          are included as well.
        </p>
        {profileQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {profileQuery.isError ? (
          <p role="alert">{(profileQuery.error as Error).message}</p>
        ) : null}
        <label className="field" htmlFor="user-ai-instructions">
          Instructions
        </label>
        <textarea
          id="user-ai-instructions"
          rows={6}
          maxLength={AI_INSTRUCTIONS_MAX}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <p className="muted small">
          {instructions.length} / {AI_INSTRUCTIONS_MAX}
        </p>
        {saveInstructions.isError ? (
          <p role="alert">{(saveInstructions.error as Error).message}</p>
        ) : null}
        <button
          type="button"
          className="btn primary small"
          disabled={saveInstructions.isPending || profileQuery.isLoading}
          onClick={() => saveInstructions.mutate()}
        >
          Save instructions
        </button>
      </section>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Provider keys</h2>
        {data?.keyMode === "instance_only" ? (
          <p className="muted">
            This instance uses the Administrator key. A personal key is saved here and is not used
            until the key mode changes.
          </p>
        ) : null}
        {statusQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {statusQuery.isError ? <p role="alert">{(statusQuery.error as Error).message}</p> : null}
        {data && cloudPlugins.length === 0 ? (
          <p className="muted">No cloud providers are enabled.</p>
        ) : null}
        {cloudPlugins.map((plugin) => (
          <KeyBlock
            key={plugin.id}
            plugin={plugin}
            credential={credentialsQuery.data?.find((row) => row.pluginId === plugin.id) ?? null}
          />
        ))}
        {(data?.plugins ?? [])
          .filter((plugin) => plugin.enabled && plugin.capabilities.local)
          .map((plugin) => (
            <p key={plugin.id} className="muted">
              {plugin.displayName}: no key — this provider runs on your network.
            </p>
          ))}
      </section>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Models</h2>
        {routingQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {routingQuery.isError ? <p role="alert">{(routingQuery.error as Error).message}</p> : null}
        {routingQuery.data?.features.map((feature) => (
          <FeatureModel key={feature.id} feature={feature} plugins={data?.plugins ?? []} />
        ))}
      </section>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Features</h2>
        {policyQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {policyQuery.isError ? <p role="alert">{(policyQuery.error as Error).message}</p> : null}
        {policy && draft
          ? policy.features.map((feature) => (
              <div key={feature.id}>
                <label className="appearance-separate">
                  <input
                    type="checkbox"
                    checked={feature.locked ? false : !draft.featuresOff.includes(feature.id)}
                    disabled={feature.locked || savePolicy.isPending}
                    onChange={(event) => {
                      const base = policyDraft ?? draftFromPolicy(policy);
                      const next = new Set(base.featuresOff);
                      if (event.target.checked) next.delete(feature.id);
                      else next.add(feature.id);
                      for (const row of policy.features) {
                        if (row.locked) next.add(row.id);
                      }
                      setPolicyDraft({ ...base, featuresOff: [...next] });
                    }}
                  />
                  <span>Use {featureLabel(feature.id)}</span>
                </label>
                {feature.locked ? (
                  <p className="ai-policy-lock muted">
                    <span aria-hidden="true">🔒</span>
                    <span>Disabled by your Administrator</span>
                  </p>
                ) : null}
              </div>
            ))
          : null}
        {policy && draft ? (
          <p>
            <button
              type="button"
              className="btn small primary"
              disabled={savePolicy.isPending || !policyDraft}
              onClick={() => savePolicy.mutate(draftToBody(policy, draft))}
            >
              {savePolicy.isPending ? "Saving…" : "Save AI limits"}
            </button>
          </p>
        ) : null}
      </section>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Permission tiers</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Inherit follows the Administrator. A higher number asks for more review. Off refuses that
          action. Locked cells stay off.
        </p>
        {policy && draft ? (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--compact">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Default</th>
                    {AI_POLICY_RECORD_TYPES.map((recordType) => (
                      <th key={recordType.id}>{recordType.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {AI_POLICY_ACTIONS.map((action) => (
                    <tr key={action.id}>
                      <th scope="row">{action.label}</th>
                      <td>
                        <PolicyCell
                          label={`${action.label} default`}
                          policy={policy}
                          cellKey={action.id}
                          choice={draft.cells[action.id] ?? "inherit"}
                          disabled={savePolicy.isPending}
                          onChange={(choice) => {
                            const base = policyDraft ?? draftFromPolicy(policy);
                            setPolicyDraft({
                              ...base,
                              cells: { ...base.cells, [action.id]: choice },
                            });
                          }}
                        />
                      </td>
                      {AI_POLICY_RECORD_TYPES.map((recordType) => {
                        const key = aiPolicyCellKey(action.id, recordType.id);
                        return (
                          <td key={key}>
                            <PolicyCell
                              label={`${action.label} on ${recordType.label}`}
                              policy={policy}
                              cellKey={key}
                              choice={draft.cells[key] ?? "inherit"}
                              disabled={savePolicy.isPending}
                              onChange={(choice) => {
                                const base = policyDraft ?? draftFromPolicy(policy);
                                setPolicyDraft({
                                  ...base,
                                  cells: { ...base.cells, [key]: choice },
                                });
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Floor</h3>
            <p className="muted small" style={{ marginTop: 0 }}>
              Denied — no toggle. The assistant cannot touch these.
            </p>
            <ul>
              {AI_POLICY_FLOOR.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            {savePolicy.isError ? <p role="alert">{(savePolicy.error as Error).message}</p> : null}
            <p>
              <button
                type="button"
                className="btn small primary"
                disabled={savePolicy.isPending || !policyDraft}
                onClick={() => {
                  if (!policy || !draft) return;
                  savePolicy.mutate(draftToBody(policy, draft));
                }}
              >
                {savePolicy.isPending ? "Saving…" : "Save AI limits"}
              </button>
            </p>
          </>
        ) : null}
      </section>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Usage today</h2>
        {usageQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {usageQuery.isError ? <p role="alert">{(usageQuery.error as Error).message}</p> : null}
        {usageQuery.data ? (
          <>
            {usageQuery.data.blocked ? (
              <p role="alert">You have reached the AI usage budget.</p>
            ) : usageQuery.data.warning ? (
              <p role="status">You have used 80% of today’s AI budget.</p>
            ) : null}
            <ul className="assistant-status-list">
              <li>
                Tokens: <strong>{usageQuery.data.tokensUsed}</strong>
                {usageQuery.data.tokenLimit == null
                  ? " (no daily cap)"
                  : ` / ${usageQuery.data.tokenLimit}`}
              </li>
              {usageQuery.data.instanceSpendMicroUsd != null ? (
                <li>
                  Instance-key spend:{" "}
                  <strong>{formatUsdFromMicro(usageQuery.data.instanceSpendMicroUsd)}</strong>
                  {usageQuery.data.instanceSpendLimitMicroUsd == null
                    ? " (no daily cap)"
                    : ` / ${formatUsdFromMicro(usageQuery.data.instanceSpendLimitMicroUsd)}`}
                </li>
              ) : null}
            </ul>
          </>
        ) : null}
      </section>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Automatic changes</h2>
        <label className="appearance-separate">
          <input
            type="checkbox"
            checked={optIn.isPending ? optIn.variables === true : data?.tier1OptIn === true}
            disabled={optIn.isPending || statusQuery.isLoading || data?.tier1Enabled === false}
            onChange={(event) => {
              optIn.mutate(event.target.checked);
            }}
          />
          <span>Apply small reversible changes automatically, with Undo</span>
        </label>
        {data && data.tier1Enabled === false ? (
          <p className="muted">
            Your administrator has turned this off. The preference is saved and takes effect when
            they turn it back on.
          </p>
        ) : (
          <p className="muted">
            Tags, links, comments, and task dependencies apply as soon as a chat turn is only those
            changes. Creates and edits still wait for you.
          </p>
        )}
        {optIn.isError ? <p role="alert">{(optIn.error as Error).message}</p> : null}
        <p>
          <button type="button" className="btn small" onClick={() => setSection("ai-activity")}>
            AI activity and Undo
          </button>
        </p>
      </section>
    </div>
  );
}

function KeyBlock({
  plugin,
  credential,
}: {
  plugin: AssistantPluginStatus;
  credential: UserAiCredential | null;
}) {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const defaultModel = modelOverride ?? credential?.defaultModel ?? "";
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      putUserAiCredential(plugin.id, {
        apiKey,
        defaultModel: defaultModel.trim() ? defaultModel.trim() : null,
      }),
    onSuccess: async () => {
      setApiKey("");
      setModelOverride(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["ai-credentials"] });
      await queryClient.invalidateQueries({ queryKey: ["assistant-status"] });
      await queryClient.invalidateQueries({ queryKey: ["ai-routing"] });
      await queryClient.invalidateQueries({ queryKey: ["ai-capabilities"] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteUserAiCredential(plugin.id),
    onSuccess: async () => {
      setApiKey("");
      setModelOverride("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["ai-credentials"] });
      await queryClient.invalidateQueries({ queryKey: ["assistant-status"] });
      await queryClient.invalidateQueries({ queryKey: ["ai-capabilities"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div style={{ marginTop: "1rem" }}>
      <h3 style={{ marginBottom: "0.35rem" }}>{plugin.displayName}</h3>
      {credential?.keyHint ? (
        <p className="muted small" style={{ marginTop: 0 }}>
          Saved key ending in {credential.keyHint}
          {credential.verifiedAt ? " · verified" : ""}
          {credential.defaultModel ? ` · default model ${credential.defaultModel}` : ""}
        </p>
      ) : (
        <p className="muted small" style={{ marginTop: 0 }}>
          No personal key saved.
        </p>
      )}
      {credential?.lastError ? <p role="alert">{credential.lastError}</p> : null}
      <label className="field">
        <span>API key</span>
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <label className="field">
        <span>Default model for this key</span>
        <input
          type="text"
          value={defaultModel}
          maxLength={120}
          onChange={(event) => setModelOverride(event.target.value)}
        />
      </label>
      <p className="muted small">Enter the key again to change the default model. It is not shown after save.</p>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        <button
          type="button"
          className="btn small"
          disabled={save.isPending || apiKey.trim().length === 0}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Checking…" : "Save and verify"}
        </button>{" "}
        {credential ? (
          <button
            type="button"
            className="btn small"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove
          </button>
        ) : null}
      </p>
    </div>
  );
}

function FeatureModel({
  feature,
  plugins,
}: {
  feature: AiRoutingFeature;
  plugins: AssistantPluginStatus[];
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const recommended = recommendedRoute(feature);
  const save = useMutation({
    mutationFn: (pin: { pluginId: string; model: string } | null) => putAiRoute(feature.id, pin),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["ai-routing"] });
      await queryClient.invalidateQueries({ queryKey: ["assistant-status"] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const current = feature.preference
    ? `${feature.preference.pluginId}::${feature.preference.model}`
    : "";
  const autoLabel = recommended
    ? `Automatic (recommended: ${recommended.model})`
    : "Automatic";

  return (
    <label className="field">
      <span>Model for {featureLabel(feature.id)}</span>
      <select
        value={current}
        disabled={save.isPending}
        onChange={(event) => {
          const value = event.target.value;
          if (!value) {
            save.mutate(null);
            return;
          }
          const splitAt = value.indexOf("::");
          save.mutate({
            pluginId: value.slice(0, splitAt),
            model: value.slice(splitAt + 2),
          });
        }}
      >
        <option value="">{autoLabel}</option>
        {feature.eligible.map((row) => {
          const name = plugins.find((plugin) => plugin.id === row.pluginId)?.displayName ?? row.pluginId;
          const recommendedMark =
            recommended && recommended.pluginId === row.pluginId && recommended.model === row.model;
          return (
            <option key={`${row.pluginId}::${row.model}`} value={`${row.pluginId}::${row.model}`}>
              {name} / {row.model}
              {recommendedMark ? " — Recommended" : ""} ({row.size})
            </option>
          );
        })}
      </select>
      {error ? <p role="alert">{error}</p> : null}
    </label>
  );
}

function PolicyCell({
  label,
  policy,
  cellKey,
  choice,
  disabled,
  onChange,
}: {
  label: string;
  policy: UserAiPolicyView;
  cellKey: string;
  choice: CellChoice;
  disabled: boolean;
  onChange: (choice: CellChoice) => void;
}) {
  if (policy.locked.includes(cellKey)) {
    return (
      <span className="ai-policy-lock muted" title="Disabled by your Administrator">
        <span aria-hidden="true">🔒</span>
        <span>Disabled by your Administrator</span>
      </span>
    );
  }
  const cap = ceilingTier(policy, cellKey);
  const higher = ([0, 1, 2, 3] as const).filter((tier) => tier > cap);
  return (
    <select
      aria-label={label}
      value={choice}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as CellChoice)}
    >
      <option value="inherit">Inherit ({cap})</option>
      {higher.map((tier) => (
        <option key={tier} value={String(tier)}>
          {tier}
        </option>
      ))}
      <option value="off">Off</option>
    </select>
  );
}
