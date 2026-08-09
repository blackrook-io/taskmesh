import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";

type LogRow = {
  id: number;
  createdAt: string;
  outcome: string;
  method: string;
  path: string;
  statusCode: number;
  ip: string | null;
  message: string | null;
  adminKey: boolean;
};

const OUTCOMES = [
  "",
  "success",
  "api_failure",
  "auth_failure",
  "access_violation",
] as const;

export function AdminLoggingPanel() {
  const [outcome, setOutcome] = useState("");
  const [path, setPath] = useState("");
  const [pathFilter, setPathFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const logsQuery = useQuery({
    queryKey: ["admin", "api-logs", outcome, pathFilter, offset],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (outcome) params.set("outcome", outcome);
      if (pathFilter) params.set("path", pathFilter);
      const res = await apiJson<{ data: LogRow[]; total: number }>(
        `/api/v1/admin/api-logs?${params}`,
      );
      return res;
    },
    refetchInterval: 15_000,
  });

  const rows = logsQuery.data?.data ?? [];
  const total = logsQuery.data?.total ?? 0;

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Server API request log. Auth-specific outcomes appear once API keys and login are
        enforced.
      </p>

      <div className="admin-toolbar admin-log-filters">
        <label className="field field--inline">
          <span>Outcome</span>
          <select value={outcome} onChange={(e) => { setOutcome(e.target.value); setOffset(0); }}>
            {OUTCOMES.map((o) => (
              <option key={o || "all"} value={o}>
                {o || "All"}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--inline">
          <span>Path contains</span>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPathFilter(path.trim());
                setOffset(0);
              }
            }}
            placeholder="/api/v1/…"
          />
        </label>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            setPathFilter(path.trim());
            setOffset(0);
          }}
        >
          Filter
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table admin-table--compact">
          <thead>
            <tr>
              <th>When</th>
              <th>Outcome</th>
              <th>Status</th>
              <th>Request</th>
              <th>IP</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No log rows yet. Use the app to generate traffic.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted small">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td>
                    <span className={`admin-badge admin-badge--${r.outcome}`}>
                      {r.outcome}
                    </span>
                    {r.adminKey ? (
                      <span className="admin-badge admin-badge--warn">ADMIN KEY</span>
                    ) : null}
                  </td>
                  <td>{r.statusCode}</td>
                  <td>
                    <code>
                      {r.method} {r.path}
                    </code>
                  </td>
                  <td className="muted small">{r.ip ?? "—"}</td>
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
