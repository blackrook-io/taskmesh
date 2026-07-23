import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchAssistantStatus } from "../api/assistant";

export function AssistantSettingsPage() {
  const statusQuery = useQuery({
    queryKey: ["assistant-status"],
    queryFn: fetchAssistantStatus,
  });

  const data = statusQuery.data;

  return (
    <div>
      <div className="page-head">
        <h1>Assistant</h1>
        <Link to="/" className="btn ghost">
          Home
        </Link>
      </div>
      <p className="muted">
        TaskMesh talks to OpenAI with a server-side API key. Keys stay in <code>.env</code> on the
        host (not entered in the browser). Outbound HTTPS to <code>api.openai.com</code> is
        required.
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
          </ul>
        ) : null}
      </section>

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
            On the server, edit <code>/srv/taskmesh/.env</code>:
            <pre className="assistant-env-sample">{`OPENAI_API_KEY=sk-...
ASSISTANT_DEFAULT_PROVIDER=openai
ASSISTANT_DEFAULT_MODEL=gpt-4.1-mini`}</pre>
          </li>
          <li>
            Restart: <code>sudo systemctl restart taskmesh</code> (or restart <code>npm run
            dev:web</code>).
          </li>
        </ol>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Details: INSTALL.md § Assistant.
        </p>
      </section>
    </div>
  );
}
