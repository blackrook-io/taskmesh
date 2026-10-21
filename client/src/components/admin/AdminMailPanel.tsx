import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";
import { useAdministration } from "../../lib/administration";
import { requestEmailLogTab } from "../../lib/adminLogSource";
import { AdminMailLog } from "./AdminMailLog";
import {
  AdminRangeToggle,
  AdminUsageChart,
  type UsageRange,
} from "./AdminUsageChart";

type MailEncryption = "none" | "starttls" | "tls";

type MailPublic = {
  enabled: boolean;
  host: string;
  port: number;
  encryption: MailEncryption;
  username: string;
  passwordSet: boolean;
  passwordHint: string | null;
  apiTokenSet: boolean;
  apiTokenHint: string | null;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  timeoutSeconds: number;
  credentialsKeyConfigured: boolean;
  updatedAt: string | null;
};

type Draft = {
  enabled: boolean;
  host: string;
  port: string;
  encryption: MailEncryption;
  username: string;
  password: string;
  clearPassword: boolean;
  apiToken: string;
  clearApiToken: boolean;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  timeoutSeconds: string;
};

type MailActivity = {
  range: UsageRange;
  queue: { created: number; active: number; retry: number; failed: number };
  series: { t: string; sent: number; failed: number; retries: number }[];
};

function draftFrom(settings: MailPublic): Draft {
  return {
    enabled: settings.enabled,
    host: settings.host,
    port: String(settings.port),
    encryption: settings.encryption,
    username: settings.username,
    password: "",
    clearPassword: false,
    apiToken: "",
    clearApiToken: false,
    fromAddress: settings.fromAddress,
    fromName: settings.fromName,
    replyTo: settings.replyTo,
    timeoutSeconds: String(settings.timeoutSeconds),
  };
}

export function AdminMailPanel() {
  const qc = useQueryClient();
  const { setSection } = useAdministration();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [range, setRange] = useState<UsageRange>("1d");

  const settingsQuery = useQuery({
    queryKey: ["admin", "mail"],
    queryFn: async () => {
      const res = await apiJson<{ data: MailPublic }>("/api/v1/admin/mail");
      return res.data;
    },
  });

  const activityQuery = useQuery({
    queryKey: ["admin", "mail-activity", range],
    queryFn: async () => {
      const res = await apiJson<{ data: MailActivity }>(`/api/v1/admin/mail/activity?range=${range}`);
      return res.data;
    },
    refetchInterval: 15_000,
  });

  const settings = settingsQuery.data;
  const form = draft ?? (settings ? draftFrom(settings) : null);

  const saveMutation = useMutation({
    mutationFn: async (body: Draft) => {
      const port = Number.parseInt(body.port, 10);
      const timeoutSeconds = Number.parseInt(body.timeoutSeconds, 10);
      if (!Number.isFinite(port) || !Number.isFinite(timeoutSeconds)) {
        throw new Error("Port and timeout must be whole numbers.");
      }
      const res = await apiJson<{ data: MailPublic }>("/api/v1/admin/mail", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: body.enabled,
          host: body.host.trim(),
          port,
          encryption: body.encryption,
          username: body.username.trim(),
          password: body.password,
          clearPassword: body.clearPassword,
          apiToken: body.apiToken,
          clearApiToken: body.clearApiToken,
          fromAddress: body.fromAddress.trim(),
          fromName: body.fromName.trim(),
          replyTo: body.replyTo.trim(),
          timeoutSeconds,
        }),
      });
      return res.data;
    },
    onSuccess: async () => {
      setDraft(null);
      setError(null);
      setNotice("Mail settings saved.");
      await qc.invalidateQueries({ queryKey: ["admin", "mail"] });
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const connectionMutation = useMutation({
    mutationFn: async () => {
      await apiJson("/api/v1/admin/mail/test-connection", { method: "POST" });
    },
    onSuccess: async () => {
      setError(null);
      setNotice("Connection succeeded.");
      await qc.invalidateQueries({ queryKey: ["admin", "mail-log"] });
      await qc.invalidateQueries({ queryKey: ["admin", "mail-activity"] });
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
      void qc.invalidateQueries({ queryKey: ["admin", "mail-log"] });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (to: string) => {
      await apiJson("/api/v1/admin/mail/test-send", {
        method: "POST",
        body: JSON.stringify({ to }),
      });
    },
    onSuccess: async () => {
      setError(null);
      setNotice("Test message queued. Delivery is recorded in the email log.");
      await qc.invalidateQueries({ queryKey: ["admin", "mail-log"] });
      await qc.invalidateQueries({ queryKey: ["admin", "mail-activity"] });
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const patch = (partial: Partial<Draft>) => {
    if (!form) return;
    setDraft({ ...form, ...partial });
    setNotice(null);
  };

  const queue = activityQuery.data?.queue;
  const series = activityQuery.data?.series ?? [];

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Outbound mail for later notifications. The password is the SMTP password. When it is
        blank, the API token is used as that password. Secrets stay on the server. A saved
        secret is not shown again; leave the field blank to keep it.
      </p>

      {settings && !settings.credentialsKeyConfigured ? (
        <p role="alert" className="tag-input__error">
          Set EMAIL_CREDENTIALS_KEY (at least 32 characters) and restart the API before saving a
          password or API token.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="tag-input__error">
          {error}
        </p>
      ) : null}
      {settingsQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {settingsQuery.isError ? (
        <p role="alert" className="tag-input__error">
          {(settingsQuery.error as Error).message}
        </p>
      ) : null}

      {form && settings ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            saveMutation.mutate(form);
          }}
        >
          <h4 className="admin-db-heading">Connection settings</h4>
          <label className="field">
            <span>Host server</span>
            <input
              value={form.host}
              onChange={(e) => patch({ host: e.target.value })}
              autoComplete="off"
              placeholder="smtp.example.com"
            />
          </label>
          <div className="admin-field-pair">
            <label className="field">
              <span>Port</span>
              <input
                value={form.port}
                onChange={(e) => patch({ port: e.target.value })}
                inputMode="numeric"
              />
            </label>
            <label className="field">
              <span>Encryption</span>
              <select
                value={form.encryption}
                onChange={(e) => patch({ encryption: e.target.value as MailEncryption })}
              >
                <option value="starttls">STARTTLS</option>
                <option value="tls">TLS (implicit)</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>

          <h4 className="admin-db-heading">Server account authentication</h4>
          <div className="admin-field-pair">
            <label className="field">
              <span>Username</span>
              <input
                value={form.username}
                onChange={(e) => patch({ username: e.target.value })}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>
                Password
                {settings.passwordSet
                  ? ` (saved${settings.passwordHint ? `, ends ${settings.passwordHint}` : ""})`
                  : ""}
              </span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => patch({ password: e.target.value, clearPassword: false })}
                autoComplete="new-password"
                placeholder={settings.passwordSet ? "Leave blank to keep" : ""}
                disabled={!settings.credentialsKeyConfigured}
              />
            </label>
          </div>
          {settings.passwordSet ? (
            <label className="field">
              <span>
                <input
                  type="checkbox"
                  checked={form.clearPassword}
                  onChange={(e) => patch({ clearPassword: e.target.checked, password: "" })}
                />{" "}
                Remove saved password
              </span>
            </label>
          ) : null}
          <label className="field">
            <span>
              API token
              {settings.apiTokenSet
                ? ` (saved${settings.apiTokenHint ? `, ends ${settings.apiTokenHint}` : ""})`
                : ""}
            </span>
            <input
              type="password"
              value={form.apiToken}
              onChange={(e) => patch({ apiToken: e.target.value, clearApiToken: false })}
              autoComplete="new-password"
              placeholder={settings.apiTokenSet ? "Leave blank to keep" : ""}
              disabled={!settings.credentialsKeyConfigured}
            />
          </label>
          {settings.apiTokenSet ? (
            <label className="field">
              <span>
                <input
                  type="checkbox"
                  checked={form.clearApiToken}
                  onChange={(e) => patch({ clearApiToken: e.target.checked, apiToken: "" })}
                />{" "}
                Remove saved API token
              </span>
            </label>
          ) : null}

          <h4 className="admin-db-heading">Envelope and sender identity</h4>
          <label className="field">
            <span>From address</span>
            <input
              type="email"
              value={form.fromAddress}
              onChange={(e) => patch({ fromAddress: e.target.value })}
              autoComplete="off"
              placeholder="noreply@example.com"
            />
          </label>
          <label className="field">
            <span>From name</span>
            <input
              value={form.fromName}
              onChange={(e) => patch({ fromName: e.target.value })}
              autoComplete="off"
              placeholder="TaskMesh"
            />
          </label>
          <label className="field">
            <span>Reply-to address</span>
            <input
              type="email"
              value={form.replyTo}
              onChange={(e) => patch({ replyTo: e.target.value })}
              autoComplete="off"
            />
          </label>

          <h4 className="admin-db-heading">Options</h4>
          <label className="field">
            <span>Timeout (seconds)</span>
            <input
              value={form.timeoutSeconds}
              onChange={(e) => patch({ timeoutSeconds: e.target.value })}
              inputMode="numeric"
            />
          </label>

          <div className="admin-toolbar admin-mail-actions">
            <label className="admin-mail-enable">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => patch({ enabled: e.target.checked })}
              />
              Enable outbound email
            </label>
            {notice ? <span className="muted">{notice}</span> : null}
            <button type="submit" className="btn small primary" disabled={saveMutation.isPending}>
              Save
            </button>
            <button
              type="button"
              className="btn small"
              disabled={connectionMutation.isPending}
              onClick={() => {
                setError(null);
                connectionMutation.mutate();
              }}
            >
              Test connection
            </button>
          </div>
        </form>
      ) : null}

      <h4 className="admin-db-heading">Send a test message</h4>
      <p className="muted">Uses the saved settings, including when outbound email is still off.</p>
      <form
        className="admin-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          sendMutation.mutate(testTo.trim());
        }}
      >
        <label className="field field--inline">
          <span>To</span>
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            required
            autoComplete="off"
          />
        </label>
        <button type="submit" className="btn small primary" disabled={sendMutation.isPending}>
          Queue test
        </button>
      </form>

      <h4 className="admin-db-heading">Recent email log</h4>
      <p className="muted">
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            requestEmailLogTab();
            setSection("logging");
          }}
        >
          Open System Logs
        </button>
      </p>
      <AdminMailLog recent />

      <h4 className="admin-db-heading">Email activity</h4>
      <AdminRangeToggle range={range} onChange={setRange} />
      {activityQuery.isError ? (
        <p role="alert" className="tag-input__error">
          {(activityQuery.error as Error).message}
        </p>
      ) : null}
      <table className="admin-table">
        <thead>
          <tr>
            <th>Queued</th>
            <th>Active</th>
            <th>Retry</th>
            <th>Failed</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{queue?.created ?? 0}</td>
            <td>{queue?.active ?? 0}</td>
            <td>{queue?.retry ?? 0}</td>
            <td>{queue?.failed ?? 0}</td>
          </tr>
        </tbody>
      </table>
      <h4 className="admin-db-heading">Sends</h4>
      <AdminUsageChart
        series={series}
        valueOf={(point) => point.sent}
        label="Email sends"
        color="var(--accent, #7dcea0)"
      />
      <h4 className="admin-db-heading">Failures</h4>
      <AdminUsageChart
        series={series}
        valueOf={(point) => point.failed}
        label="Email failures"
        color="#e07a5f"
      />
      <h4 className="admin-db-heading">Retries</h4>
      <AdminUsageChart
        series={series}
        valueOf={(point) => point.retries}
        label="Email retries"
        color="#e0c36a"
      />
    </div>
  );
}
