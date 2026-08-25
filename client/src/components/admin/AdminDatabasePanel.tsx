import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../../api/client";
import { formatBytes } from "../../lib/formatBytes";
import {
  AdminRangeToggle,
  AdminUsageChart,
  type UsageRange,
} from "./AdminUsageChart";

type SeriesPoint = {
  t: string;
  databaseSizeBytes: number;
  tableCount: number;
  databaseCount: number;
  requestCount: number;
  requestBytes: number;
  responseBytes: number;
};

type Current = {
  datname: string;
  databaseSizeBytes: number;
  tableCount: number;
  databaseCount: number;
  sampledAt: string | null;
};

const CHARTS: {
  key: keyof Omit<SeriesPoint, "t">;
  label: string;
  color: string;
  format: (v: number) => string;
}[] = [
  {
    key: "databaseSizeBytes",
    label: "Database size",
    color: "var(--accent, #7dcea0)",
    format: formatBytes,
  },
  {
    key: "responseBytes",
    label: "Egress (cumulative)",
    color: "#6c9bcf",
    format: formatBytes,
  },
  {
    key: "requestBytes",
    label: "Ingress (from clients)",
    color: "#f2cc8f",
    format: formatBytes,
  },
  {
    key: "requestCount",
    label: "API requests (cumulative)",
    color: "#9b5de5",
    format: (v) => String(Math.round(v)),
  },
  {
    key: "tableCount",
    label: "Tables in use",
    color: "#e07a5f",
    format: (v) => String(Math.round(v)),
  },
  {
    key: "databaseCount",
    label: "Databases in use",
    color: "#81b29a",
    format: (v) => String(Math.round(v)),
  },
];

export function AdminDatabasePanel() {
  const [range, setRange] = useState<UsageRange>("1d");

  const statsQuery = useQuery({
    queryKey: ["admin", "database-stats", range],
    queryFn: async () => {
      const res = await apiJson<{
        data: { range: UsageRange; current: Current; series: SeriesPoint[] };
      }>(`/api/v1/admin/database-stats/summary?range=${range}`);
      return res.data;
    },
    refetchInterval: 30_000,
  });

  const series = statsQuery.data?.series ?? [];
  const current = statsQuery.data?.current;

  const totals = useMemo(() => {
    const t = { requestCount: 0, requestBytes: 0, responseBytes: 0 };
    for (const p of series) {
      t.requestCount += p.requestCount;
      t.requestBytes += p.requestBytes;
      t.responseBytes += p.responseBytes;
    }
    return t;
  }, [series]);

  const chartSeries = useMemo(() => {
    let requestCount = 0;
    let responseBytes = 0;
    return series.map((p) => {
      requestCount += p.requestCount;
      responseBytes += p.responseBytes;
      return { ...p, requestCount, responseBytes };
    });
  }, [series]);

  const valueOf = useCallback(
    (key: keyof Omit<SeriesPoint, "t">) => (p: SeriesPoint) => p[key],
    [],
  );

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        App database only. Size is <code>pg_database_size</code> (data + indexes), matching
        typical hosted-Postgres billing. Egress/ingress are HTTP bytes on{" "}
        <code>/api/v1</code> (network to/from clients). Size and table charts fill as
        5-minute snapshots accumulate. API request and egress charts are running totals
        for the selected range.
      </p>

      {current ? (
        <>
          <p className="admin-db-heading">
            Database:{" "}
            <strong className="admin-db-heading__name">{current.datname}</strong>
          </p>
          <table className="admin-db-stats">
            <tbody>
              <tr>
                <th scope="row">Size</th>
                <td className="admin-db-stats__value">
                  {formatBytes(current.databaseSizeBytes)}
                </td>
              </tr>
              <tr>
                <th scope="row">Tables</th>
                <td className="admin-db-stats__value">{current.tableCount}</td>
              </tr>
              <tr>
                <th scope="row">Databases</th>
                <td className="admin-db-stats__value">{current.databaseCount}</td>
              </tr>
              <tr>
                <th scope="row">API requests (range)</th>
                <td className="admin-db-stats__value">{totals.requestCount}</td>
              </tr>
              <tr>
                <th scope="row">Egress (range)</th>
                <td className="admin-db-stats__value">
                  {formatBytes(totals.responseBytes)}
                </td>
              </tr>
              <tr>
                <th scope="row">Ingress (range)</th>
                <td className="admin-db-stats__value">
                  {formatBytes(totals.requestBytes)}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}

      <div className="admin-db-range">
        <AdminRangeToggle range={range} onChange={setRange} />
      </div>

      {statsQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {statsQuery.isError ? (
        <p className="error-text">{(statsQuery.error as Error).message}</p>
      ) : null}

      {statsQuery.data ? (
        <div className="admin-usage-stack">
          {CHARTS.map((chart) => (
            <section key={chart.key} className="admin-usage-block">
              <h4 className="admin-usage-block__title">
                <span
                  className="admin-stat__swatch"
                  style={{ background: chart.color }}
                  aria-hidden
                />
                {chart.label}
              </h4>
              <AdminUsageChart
                series={chartSeries}
                valueOf={valueOf(chart.key)}
                label={chart.label}
                color={chart.color}
                formatY={chart.format}
              />
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
