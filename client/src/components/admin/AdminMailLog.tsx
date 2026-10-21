import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../../api/client";

type MailLogRow = {
  id: number;
  createdAt: string;
  result: string;
  toAddress: string;
  subject: string;
  warning: string | null;
  error: string | null;
  kind: string;
};

const RESULTS = ["", "queued", "sent", "failed", "retry", "verified"] as const;
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

function resultClass(result: string): string {
  if (result === "sent" || result === "verified") return "admin-badge--success";
  if (result === "failed") return "admin-badge--api_failure";
  return "admin-badge--warn";
}

export function AdminMailLog({ recent = false }: { recent?: boolean }) {
  const [result, setResult] = useState("");
  const [datePreset, setDatePreset] = useState("");
  const [search, setSearch] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = recent ? 8 : 50;

  const logsQuery = useQuery({
    queryKey: ["admin", "mail-log", recent, result, datePreset, searchFilter, offset],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (!recent && result) params.set("result", result);
      const since = recent ? undefined : sinceForPreset(datePreset);
      if (since) params.set("since", since);
      if (!recent && searchFilter) params.set("q", searchFilter);
      return apiJson<{ data: MailLogRow[]; total: number }>(`/api/v1/admin/mail/log?${params}`);
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
    <>
      {recent ? null : (
        <div className="admin-toolbar admin-log-filters">
          <label className="field field--inline">
            <span>Result</span>
            <select
              value={result}
              onChange={(e) => {
                setResult(e.target.value);
                setOffset(0);
              }}
            >
              {RESULTS.map((value) => (
                <option key={value || "all"} value={value}>
                  {value || "All"}
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
              placeholder="To, subject, or error"
            />
          </label>
          <button type="button" className="btn small" onClick={applySearch}>
            Filter
          </button>
        </div>
      )}

      {logsQuery.isError ? (
        <p role="alert" className="tag-input__error">
          {(logsQuery.error as Error).message}
        </p>
      ) : null}

      <div className="admin-table-wrap">
        <table className="admin-table admin-table--compact">
          <thead>
            <tr>
              <th>Timestamp (GMT)</th>
              <th>Result</th>
              <th>To</th>
              <th>Subject</th>
              <th>Server note</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No email transactions yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="muted small admin-log-ts">{formatGmt(row.createdAt)}</td>
                  <td>
                    <span className={`admin-badge ${resultClass(row.result)}`}>{row.result}</span>
                  </td>
                  <td className="muted small">{row.toAddress || "—"}</td>
                  <td className="muted small">{row.subject || "—"}</td>
                  <td className="muted small">{row.error || row.warning || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {recent ? null : (
        <div className="admin-toolbar">
          <span className="muted small">
            {total === 0 ? "0 rows" : `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`}
          </span>
          <button
            type="button"
            className="btn ghost small"
            disabled={offset <= 0}
            onClick={() => setOffset((current) => Math.max(0, current - limit))}
          >
            Prev
          </button>
          <button
            type="button"
            className="btn ghost small"
            disabled={offset + limit >= total}
            onClick={() => setOffset((current) => current + limit)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
