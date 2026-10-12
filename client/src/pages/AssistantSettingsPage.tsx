import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAssistantStatus } from "../api/assistant";
import { fetchUserAiUsage, formatUsdFromMicro } from "../api/aiUsage";
import { patchTier1OptIn } from "../api/aiActivity";
import { useSettings } from "../lib/settings";

type Props = {
  embedded?: boolean;
};

export function AssistantSettingsPage({ embedded = false }: Props) {
  const queryClient = useQueryClient();
  const { setSection } = useSettings();
  const statusQuery = useQuery({
    queryKey: ["assistant-status"],
    queryFn: fetchAssistantStatus,
  });
  const usageQuery = useQuery({
    queryKey: ["ai-usage"],
    queryFn: fetchUserAiUsage,
  });
  const optIn = useMutation({
    mutationFn: patchTier1OptIn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["assistant-status"] });
    },
  });

  const data = statusQuery.data;

  return (
    <div className={embedded ? "settings-panel" : undefined}>
      {embedded ? null : (
        <div className="page-head">
          <h1>Assistant</h1>
        </div>
      )}
      <p className="muted" style={embedded ? { marginTop: 0 } : undefined}>
        TaskMesh talks to an Administrator-enabled AI provider. Administrators store an instance
        key under Administration → System properties. <code>OPENAI_API_KEY</code> in the server{" "}
        <code>.env</code> remains a deprecated fallback when no instance key is stored. The
        provider base URL must be public https.
      </p>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2>Status</h2>
        {statusQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {statusQuery.isError ? (
          <p role="alert">{(statusQuery.error as Error).message}</p>
        ) : null}
        {data ? (
          <ul className="assistant-status-list">
            <li>
              Enabled:{" "}
              <strong className={data.enabled ? "backup-health--ok" : "backup-health--missing"}>
                {data.enabled ? "Yes" : "No"}
              </strong>
            </li>
            <li>
              Provider: <code>{data.provider}</code>
            </li>
            <li>
              Model: <code>{data.model}</code>
            </li>
            <li>
              OpenAI key present: {data.configuredProviders.openai ? "Yes" : "No"}
            </li>
            {data.plugins?.map((plugin) => (
              <li key={plugin.id}>
                {plugin.displayName}: {plugin.enabled ? "enabled" : "disabled"}
                {plugin.configured ? ", key present" : ""}
              </li>
            ))}
          </ul>
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
                {usageQuery.data.tokenLimit == null ? " (no daily cap)" : ` / ${usageQuery.data.tokenLimit}`}
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
            disabled={optIn.isPending || statusQuery.isLoading}
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

      {data && !data.enabled ? (
        <section className="card" style={{ marginTop: "1.25rem" }}>
          <h2>Configure</h2>
          <ol className="muted" style={{ paddingLeft: "1.25rem" }}>
            <li>
              Create a key at{" "}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                platform.openai.com/api-keys
              </a>
              .
            </li>
            <li>
              Set <code>AI_CREDENTIALS_KEY</code> in <code>/srv/taskmesh/.env</code> (at least 32
              characters), restart the API, then store the provider key under Administration →
              System properties. The deprecated fallback is still:
              <pre className="assistant-env-sample">{`OPENAI_API_KEY=sk-...
ASSISTANT_DEFAULT_MODEL=gpt-4.1-mini`}</pre>
            </li>
            <li>
              On first boot with <code>OPENAI_API_KEY</code> set, the OpenAI plugin is enabled.
              Administrators can change that under Administration → System properties.
            </li>
          </ol>
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            Details: INSTALL.md § Assistant.
          </p>
        </section>
      ) : null}
    </div>
  );
}
