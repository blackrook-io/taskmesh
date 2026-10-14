import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson, applySpaClientHeaders, maybeNotifySessionExpired } from "../../api/client";
import { AI_INSTRUCTIONS_MAX } from "../../lib/aiInstructions";
import { AdminAiProvidersSection } from "./AdminAiProvidersSection";
import { AdminAiQualitySection } from "./AdminAiQualitySection";
import { AdminAiUsageSection } from "./AdminAiUsageSection";
import {
  AI_POLICY_ACTIONS,
  AI_POLICY_FLOOR,
  AI_POLICY_RECORD_TYPES,
  aiPolicyCellKey,
  type AiTier,
} from "../../lib/aiPolicyMatrix";

type Tier = AiTier;
type AiAccess = "full" | "read_only" | "excluded";

const ACTIONS = AI_POLICY_ACTIONS;
const RECORD_TYPES = AI_POLICY_RECORD_TYPES;
const FLOOR = AI_POLICY_FLOOR;

type PermissionTiers = {
  matrix: Record<string, Tier>;
  tier1Enabled: boolean;
  maxRecords: number;
  maxProjects: number;
};

type AiSettings = {
  aiWebFetch?: boolean;
  aiProjectAccessDefault?: AiAccess;
  aiProjectLocalOnly?: boolean;
  aiBudgets?: {
    tokensPerUserPerDay: number | null;
    instanceSpendUsdPerDay: number | null;
    toolCallsPerRun: number | null;
    writesPerRun: number | null;
  };
  aiInstanceUsdPerMillionTokens?: number;
  aiPermissionTiers?: PermissionTiers;
  aiInstructions?: string | null;
};

type AuditRow = {
  id: number;
  createdAt: string;
  userName: string | null;
  feature: string;
  action: string;
  decision: string;
  tier: number;
  reason: string | null;
  record: string | null;
  projectName: string | null;
};

type AdminUser = { id: number; displayName: string; referenceId: string };

function isTier(value: unknown): value is Tier {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function cellKey(action: string, recordType?: string): string {
  return aiPolicyCellKey(action, recordType);
}

function defaultMatrix(): Record<string, Tier> {
  const matrix: Record<string, Tier> = {};
  for (const action of ACTIONS) {
    matrix[action.id] = action.tier;
    for (const recordType of RECORD_TYPES) {
      matrix[cellKey(action.id, recordType.id)] = action.tier;
    }
  }
  return matrix;
}

function matrixToStore(matrix: Record<string, Tier>): Record<string, Tier> {
  const stored: Record<string, Tier> = {};
  for (const action of ACTIONS) {
    const actionTier = matrix[action.id] ?? action.tier;
    stored[action.id] = actionTier;
    for (const recordType of RECORD_TYPES) {
      const key = cellKey(action.id, recordType.id);
      const tier = matrix[key] ?? actionTier;
      if (tier !== actionTier) stored[key] = tier;
    }
  }
  return stored;
}

function matrixFromServer(stored: PermissionTiers | undefined): Record<string, Tier> {
  const matrix = defaultMatrix();
  if (!stored) return matrix;
  for (const action of ACTIONS) {
    const actionTier = stored.matrix[action.id];
    if (isTier(actionTier)) matrix[action.id] = actionTier;
    for (const recordType of RECORD_TYPES) {
      const key = cellKey(action.id, recordType.id);
      const specific = stored.matrix[key];
      if (isTier(specific)) matrix[key] = specific;
      else if (isTier(actionTier)) matrix[key] = actionTier;
    }
  }
  return matrix;
}

function optionalPositive(raw: string, label: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${label} must be a positive integer, or blank for no cap`);
  }
  return n;
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function AdminAiPanel() {
  const qc = useQueryClient();
  const [matrix, setMatrix] = useState<Record<string, Tier>>(defaultMatrix);
  const [tier1Enabled, setTier1Enabled] = useState(true);
  const [maxRecords, setMaxRecords] = useState("5");
  const [maxProjects, setMaxProjects] = useState("2");
  const [tokenLimit, setTokenLimit] = useState("");
  const [spendLimit, setSpendLimit] = useState("");
  const [toolLimit, setToolLimit] = useState("");
  const [writeLimit, setWriteLimit] = useState("");
  const [usdPerMillion, setUsdPerMillion] = useState("1");
  const [aiWebFetch, setAiWebFetch] = useState(false);
  const [aiProjectAccessDefault, setAiProjectAccessDefault] = useState<AiAccess>("full");
  const [aiProjectLocalOnly, setAiProjectLocalOnly] = useState(false);
  const [aiInstructions, setAiInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const propsQuery = useQuery({
    queryKey: ["admin", "system-properties"],
    queryFn: async () => {
      const res = await apiJson<{ data: AiSettings }>("/api/v1/admin/system-properties");
      return res.data;
    },
  });

  const [prevData, setPrevData] = useState(propsQuery.data);
  if (propsQuery.data !== prevData) {
    setPrevData(propsQuery.data);
    if (propsQuery.data) {
      const tiers = propsQuery.data.aiPermissionTiers;
      setMatrix(matrixFromServer(tiers));
      setTier1Enabled(tiers?.tier1Enabled !== false);
      setMaxRecords(String(tiers?.maxRecords ?? 5));
      setMaxProjects(String(tiers?.maxProjects ?? 2));
      const budgets = propsQuery.data.aiBudgets;
      setTokenLimit(budgets?.tokensPerUserPerDay == null ? "" : String(budgets.tokensPerUserPerDay));
      setSpendLimit(
        budgets?.instanceSpendUsdPerDay == null ? "" : String(budgets.instanceSpendUsdPerDay),
      );
      setToolLimit(budgets?.toolCallsPerRun == null ? "" : String(budgets.toolCallsPerRun));
      setWriteLimit(budgets?.writesPerRun == null ? "" : String(budgets.writesPerRun));
      if (typeof propsQuery.data.aiInstanceUsdPerMillionTokens === "number") {
        setUsdPerMillion(String(propsQuery.data.aiInstanceUsdPerMillionTokens));
      }
      setAiWebFetch(propsQuery.data.aiWebFetch === true);
      if (
        propsQuery.data.aiProjectAccessDefault === "full" ||
        propsQuery.data.aiProjectAccessDefault === "read_only" ||
        propsQuery.data.aiProjectAccessDefault === "excluded"
      ) {
        setAiProjectAccessDefault(propsQuery.data.aiProjectAccessDefault);
      }
      setAiProjectLocalOnly(propsQuery.data.aiProjectLocalOnly === true);
      setAiInstructions(propsQuery.data.aiInstructions ?? "");
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const records = Number(maxRecords);
      const projects = Number(maxProjects);
      if (!Number.isInteger(records) || records < 1) {
        throw new Error("Blast-radius record limit must be a positive integer");
      }
      if (!Number.isInteger(projects) || projects < 1) {
        throw new Error("Blast-radius project limit must be a positive integer");
      }
      const usdRate = Number(usdPerMillion);
      if (!Number.isFinite(usdRate) || usdRate < 0) {
        throw new Error("USD per million tokens must be zero or greater");
      }
      const body = {
        aiWebFetch,
        aiProjectAccessDefault,
        aiProjectLocalOnly,
        aiInstanceUsdPerMillionTokens: usdRate,
        aiBudgets: {
          tokensPerUserPerDay: optionalPositive(tokenLimit, "Tokens per user per day"),
          instanceSpendUsdPerDay: optionalPositive(spendLimit, "Instance-key spend per day"),
          toolCallsPerRun: optionalPositive(toolLimit, "Tool calls per run"),
          writesPerRun: optionalPositive(writeLimit, "Writes per run"),
        },
        aiPermissionTiers: {
          matrix: matrixToStore(matrix),
          tier1Enabled,
          maxRecords: records,
          maxProjects: projects,
        },
        aiInstructions,
      };
      const res = await apiJson<{ data: AiSettings }>("/api/v1/admin/system-properties", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return res.data;
    },
    onSuccess: async () => {
      setError(null);
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ["admin", "system-properties"] });
      await qc.invalidateQueries({ queryKey: ["admin", "ai-audit"] });
      window.setTimeout(() => setSaved(false), 2000);
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Instance ceiling for the assistant. Projects and users can only narrow these settings.
      </p>
      <AdminAiProvidersSection />

      <h2>Permission tiers</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Each cell is the tier for that action and record type. 0 is a logged read, 1 can auto-apply
        after a user opts in, 2 needs one confirmation, and 3 needs a full review. A record-type
        cell that matches the action default is stored as that default.
      </p>
      <label className="field" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={tier1Enabled}
          onChange={(e) => setTier1Enabled(e.target.checked)}
        />
        <span>Allow Tier 1 auto-apply when a user opts in</span>
      </label>
      <label className="field">
        <span>Blast radius: max records in one plan</span>
        <input
          type="number"
          min={1}
          value={maxRecords}
          onChange={(e) => setMaxRecords(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Blast radius: max projects in one plan</span>
        <input
          type="number"
          min={1}
          value={maxProjects}
          onChange={(e) => setMaxProjects(e.target.value)}
        />
      </label>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table--compact">
          <thead>
            <tr>
              <th>Action</th>
              <th>Default</th>
              {RECORD_TYPES.map((recordType) => (
                <th key={recordType.id}>{recordType.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACTIONS.map((action) => (
              <tr key={action.id}>
                <th scope="row">{action.label}</th>
                <td>
                    <TierSelect
                      label={`${action.label} default`}
                      value={matrix[action.id] ?? action.tier}
                      onChange={(tier) =>
                        setMatrix((prev) => {
                          const next = { ...prev, [action.id]: tier };
                          const previous = prev[action.id] ?? action.tier;
                          for (const recordType of RECORD_TYPES) {
                            const key = cellKey(action.id, recordType.id);
                            if ((prev[key] ?? previous) === previous) next[key] = tier;
                          }
                          return next;
                        })
                      }
                    />
                </td>
                {RECORD_TYPES.map((recordType) => {
                  const key = cellKey(action.id, recordType.id);
                  return (
                    <td key={key}>
                      <TierSelect
                        label={`${action.label} on ${recordType.label}`}
                        value={matrix[key] ?? matrix[action.id] ?? action.tier}
                        onChange={(tier) => setMatrix((prev) => ({ ...prev, [key]: tier }))}
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
        {FLOOR.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>

      <h2>Assistant web access</h2>
      <label className="field" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={aiWebFetch}
          onChange={(e) => setAiWebFetch(e.target.checked)}
        />
        <span>Allow assistant chat to fetch public web pages</span>
      </label>
      <p className="muted small" style={{ marginTop: 0 }}>
        Off by default. Background AI features cannot fetch the web. Private and local addresses
        stay blocked.
      </p>

      <h2>Project AI access</h2>
      <label className="field">
        <span>Instance default</span>
        <select
          value={aiProjectAccessDefault}
          onChange={(e) => setAiProjectAccessDefault(e.target.value as AiAccess)}
        >
          <option value="full">Full</option>
          <option value="read_only">Read-only</option>
          <option value="excluded">Excluded</option>
        </select>
      </label>
      <p className="muted small" style={{ marginTop: 0 }}>
        New projects start here. A project owner or manager can only narrow this. Excluded
        projects are never sent to a model. Read-only projects can be read but not changed by AI.
      </p>
      <label className="field" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={aiProjectLocalOnly}
          onChange={(e) => setAiProjectLocalOnly(e.target.checked)}
        />
        <span>Require local models for every project</span>
      </label>
      <p className="muted small" style={{ marginTop: 0 }}>
        Projects can only narrow this. When it is on, a cloud model is never called for project
        work, even if the local model errors or is rate-limited.
      </p>

      <h2>AI usage budgets</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Leave a limit blank for no cap. Counts use the UTC day. Instance-key spend is an estimate:
        tokens times the rate below. A user&apos;s own key is not counted in that spend.
      </p>
      <label className="field">
        <span>Tokens per user per day</span>
        <input
          type="number"
          min={1}
          value={tokenLimit}
          onChange={(e) => setTokenLimit(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Instance-key spend per day (USD)</span>
        <input
          type="number"
          min={1}
          value={spendLimit}
          onChange={(e) => setSpendLimit(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Tool calls per run</span>
        <input
          type="number"
          min={1}
          value={toolLimit}
          onChange={(e) => setToolLimit(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Writes per run</span>
        <input
          type="number"
          min={1}
          value={writeLimit}
          onChange={(e) => setWriteLimit(e.target.value)}
        />
      </label>
      <label className="field">
        <span>USD per million tokens (instance key)</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={usdPerMillion}
          onChange={(e) => setUsdPerMillion(e.target.value)}
        />
      </label>

      {propsQuery.isLoading ? <p className="muted">Loading…</p> : null}
      <h2>Instance AI instructions</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Included first whenever AI builds context. Projects and users add their own instructions
        after this text.
      </p>
      <label className="field" htmlFor="instance-ai-instructions">
        Instructions
      </label>
      <textarea
        id="instance-ai-instructions"
        rows={6}
        maxLength={AI_INSTRUCTIONS_MAX}
        value={aiInstructions}
        onChange={(e) => setAiInstructions(e.target.value)}
      />
      <p className="muted small">
        {aiInstructions.length} / {AI_INSTRUCTIONS_MAX}
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      {saved ? <p className="ok-text">Saved.</p> : null}
      <button
        type="button"
        className="btn primary small"
        disabled={saveMutation.isPending}
        onClick={() => saveMutation.mutate()}
      >
        Save AI settings
      </button>

      <AdminAiUsageSection />
      <AdminAiQualitySection />
      <AdminAiAuditSection />
    </div>
  );
}

function TierSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Tier;
  onChange: (tier: Tier) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as Tier)}
    >
      <option value={0}>0</option>
      <option value={1}>1</option>
      <option value={2}>2</option>
      <option value={3}>3</option>
    </select>
  );
}

type AuditFilters = {
  userId: string;
  feature: string;
  decision: "" | "allow" | "deny";
  from: string;
  to: string;
};

function AdminAiAuditSection() {
  const [draft, setDraft] = useState<AuditFilters>({
    userId: "",
    feature: "",
    decision: "",
    from: "",
    to: "",
  });
  const [applied, setApplied] = useState<AuditFilters>(draft);
  const [offset, setOffset] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const limit = 50;

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const res = await apiJson<{ data: AdminUser[] }>("/api/v1/admin/users");
      return res.data;
    },
  });

  const auditQuery = useQuery({
    queryKey: ["admin", "ai-audit", applied, offset],
    queryFn: async () => {
      const params = auditParams(applied);
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      const res = await apiJson<{ data: AuditRow[] }>(`/api/v1/admin/ai/audit?${params}`);
      return res.data;
    },
  });

  async function exportCsv() {
    setExportError(null);
    const params = auditParams(applied);
    const headers = new Headers();
    applySpaClientHeaders(headers);
    const path = `/api/v1/admin/ai/audit/export?${params}`;
    const res = await fetch(path, { headers, credentials: "include" });
    if (!res.ok) {
      maybeNotifySessionExpired(path, res.status);
      setExportError("Could not export the audit log.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ai-audit.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const rows = auditQuery.data ?? [];

  return (
    <section>
      <h2>Audit log</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Decisions the assistant and these settings recorded. Export downloads the current filter,
        up to 5,000 rows.
      </p>
      <div>
        <label className="field">
          <span>User</span>
          <select
            value={draft.userId}
            onChange={(e) => setDraft((prev) => ({ ...prev, userId: e.target.value }))}
          >
            <option value="">Anyone</option>
            {(usersQuery.data ?? []).map((user) => (
              <option key={user.id} value={String(user.id)}>
                {user.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Feature</span>
          <input
            value={draft.feature}
            onChange={(e) => setDraft((prev) => ({ ...prev, feature: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>Decision</span>
          <select
            value={draft.decision}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, decision: e.target.value as AuditFilters["decision"] }))
            }
          >
            <option value="">Any</option>
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </select>
        </label>
        <label className="field">
          <span>From</span>
          <input
            type="date"
            value={draft.from}
            onChange={(e) => setDraft((prev) => ({ ...prev, from: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>To</span>
          <input
            type="date"
            value={draft.to}
            onChange={(e) => setDraft((prev) => ({ ...prev, to: e.target.value }))}
          />
        </label>
      </div>
      <button
        type="button"
        className="btn small"
        onClick={() => {
          setOffset(0);
          setApplied(draft);
        }}
      >
        Apply filters
      </button>{" "}
      <button type="button" className="btn small" onClick={() => void exportCsv()}>
        Export CSV
      </button>
      {exportError ? <p className="error-text">{exportError}</p> : null}
      {auditQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {auditQuery.isError ? <p className="error-text">Could not load the audit log.</p> : null}
      <div className="admin-table-wrap">
        <table className="admin-table admin-table--compact">
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Feature</th>
              <th>Action</th>
              <th>Decision</th>
              <th>Tier</th>
              <th>Reason</th>
              <th>Record</th>
              <th>Project</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{when(row.createdAt)}</td>
                <td>{row.userName ?? ""}</td>
                <td>{row.feature}</td>
                <td>{row.action}</td>
                <td>{row.decision}</td>
                <td>{row.tier}</td>
                <td>{row.reason ?? ""}</td>
                <td>{row.record ?? ""}</td>
                <td>{row.projectName ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && !auditQuery.isLoading ? <p className="muted">No matching rows.</p> : null}
      <p>
        <button
          type="button"
          className="btn small"
          disabled={offset === 0}
          onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
        >
          Previous
        </button>{" "}
        <button
          type="button"
          className="btn small"
          disabled={rows.length < limit}
          onClick={() => setOffset((prev) => prev + limit)}
        >
          Next
        </button>
      </p>
    </section>
  );
}

function auditParams(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.feature.trim()) params.set("feature", filters.feature.trim());
  if (filters.decision) params.set("decision", filters.decision);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params;
}
