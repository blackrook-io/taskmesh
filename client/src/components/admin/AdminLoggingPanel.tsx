import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";

type LogActor = {
  id: number;
  referenceId: string;
  displayName: string;
};

type LogRow = {
  id: number;
  createdAt: string;
  outcome: string;
  level: "info" | "warn" | "error";
  success: boolean;
  method: string;
  path: string;
  statusCode: number;
  ip: string | null;
  message: string | null;
  adminKey: boolean;
  actor: LogActor | null;
  apiKeyOwner: LogActor | null;
  apiKeyPrefix: string | null;
};

const LEVELS = ["", "info", "warn", "error"] as const;
const DATE_PRESETS = [
  { id: "", label: "All time" },
  { id: "1h", label: "Last hour" },
  { id: "1d", label: "Last day" },
] as const;

function formatGmt(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

function sinceForPreset(preset: string): string | undefined {
  if (preset === "1h") return new Date(Date.now() - 60 * 60 * 1000).toISOString();
  if (preset === "1d") return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return undefined;
}

function actorLabel(row: LogRow): string {
  const a = row.actor ?? row.apiKeyOwner;
  if (!a) return "—";
  const key = row.apiKeyPrefix ? ` · ${row.apiKeyPrefix}` : "";
  return `${a.referenceId} ${a.displayName}${key}`;
}

export function AdminLoggingPanel() {
  const [level, setLevel] = useState("");
  const [datePreset, setDatePreset] = useState("");
  const [search, setSearch] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const logsQuery = useQuery({
    queryKey: ["admin", "api-logs", level, datePreset, searchFilter, offset],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (level) params.set("level", level);
      const since = sinceForPreset(datePreset);
      if (since) params.set("since", since);
      if (searchFilter) params.set("q", searchFilter);
      const res = await apiJson<{ data: LogRow[]; total: number }>(
        `/api/v1/admin/api-logs?${params}`,
      );
      return res;
    },
    refetchInterval: 15_000,
  });

  const rows = logsQuery.data?.data ?? [];
  const total = logsQuery.data?.total ?? 0;

  const applySearch = () => {
    setSearchFilter(search.trim());
    setOffset(0);
  };

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        System and API logs (UTC). Auth and access outcomes appear once login and API keys are
        enforced.
      </p>

      <div className="admin-toolbar admin-log-filters">
        <label className="field field--inline">
          <span>Level</span>
          <select
            value={level}
            onChange={(e) => {
              setLevel(e.target.value);
              setOffset(0);
            }}
          >
            {LEVELS.map((l) => (
              <option key={l || "all"} value={l}>
                {l || "All"}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--inline">
          <span>Date</span>
          <select
            value={datePreset}
            onChange={(e) => {
              setDatePreset(e.target.value);
              setOffset(0);
            }}
          >
            {DATE_PRESETS.map((p) => (
              <option key={p.id || "all"} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--inline admin-log-search">
          <span>Search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applySearch();
            }}
            placeholder="Text in message or path"
          />
        </label>
        <button type="button" className="btn small" onClick={applySearch}>
          Filter
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table admin-table--compact">
          <thead>
            <tr>
              <th>Timestamp (GMT)</th>
              <th>Result</th>
              <th>Level</th>
              <th>Request</th>
              <th>IP</th>
              <th>Actor / Key</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No log rows yet. Use the app to generate traffic.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted small admin-log-ts">{formatGmt(r.createdAt)}</td>
                  <td>
                    <span
                      className={`admin-badge ${r.success ? "admin-badge--success" : "admin-badge--api_failure"}`}
                    >
                      {r.success ? "Success" : "Failure"}
                    </span>
                    {r.adminKey ? (
                      <span className="admin-badge admin-badge--warn">ADMIN KEY</span>
                    ) : null}
                  </td>
                  <td>
                    <span className={`admin-badge admin-badge--level-${r.level}`}>
                      {r.level}
                    </span>
                  </td>
                  <td>
                    <code>
                      {r.method} {r.path}
                    </code>
                  </td>
                  <td className="muted small">{r.ip ?? "—"}</td>
                  <td className="muted small">{actorLabel(r)}</td>
                  <td className="muted small">{r.message ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-toolbar">
        <span className="muted small">
          {total === 0 ? "0 rows" : `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`}
        </span>
        <button
          type="button"
          className="btn ghost small"
          disabled={offset <= 0}
          onClick={() => setOffset((o) => Math.max(0, o - limit))}
        >
          Prev
        </button>
        <button
          type="button"
          className="btn ghost small"
          disabled={offset + limit >= total}
          onClick={() => setOffset((o) => o + limit)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
