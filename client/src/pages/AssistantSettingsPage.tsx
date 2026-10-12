import { useQuery } from "@tanstack/react-query";
import { fetchAssistantStatus } from "../api/assistant";

type Props = {
  embedded?: boolean;
};

export function AssistantSettingsPage({ embedded = false }: Props) {
  const statusQuery = useQuery({
    queryKey: ["assistant-status"],
    queryFn: fetchAssistantStatus,
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
