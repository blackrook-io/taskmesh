import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiJson } from "../../api/client";

type UsageRange = "1h" | "1d" | "1w";

type SeriesPoint = {
  t: string;
  success: number;
  apiFailure: number;
  authFailure: number;
  accessViolation: number;
};

type SeriesKey = keyof Omit<SeriesPoint, "t">;

const CHARTS: { key: SeriesKey; label: string; color: string }[] = [
  { key: "success", label: "Successful API usage", color: "var(--accent, #7dcea0)" },
  { key: "apiFailure", label: "API failures", color: "#e07a5f" },
  { key: "authFailure", label: "API auth failures", color: "#f2cc8f" },
  { key: "accessViolation", label: "Access violations", color: "#9b5de5" },
];

/** Failure charts requested as separate stacked graphs (plus success above). */
const FAILURE_CHARTS = CHARTS.filter((c) => c.key !== "success");

function UsageChart({
  series,
  seriesKey,
  label,
  color,
}: {
  series: SeriesPoint[];
  seriesKey: SeriesKey;
  label: string;
  color: string;
}) {
  const width = 640;
  const height = 160;
  const pad = { top: 12, right: 12, bottom: 24, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const maxY = useMemo(() => {
    let m = 1;
    for (const p of series) {
      m = Math.max(m, p[seriesKey]);
    }
    return m;
  }, [series, seriesKey]);

  if (series.length === 0) {
    return <p className="muted">No data in this range yet.</p>;
  }

  const n = series.length;
  const xAt = (i: number) => pad.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad.top + innerH - (v / maxY) * innerH;
  const path = series
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p[seriesKey]).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      className="admin-usage-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      {[0, 0.5, 1].map((f) => {
        const y = pad.top + innerH * (1 - f);
        return (
          <g key={f}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={pad.left - 6}
              y={y + 3}
              textAnchor="end"
              fill="var(--text-muted)"
              fontSize={10}
            >
              {Math.round(maxY * f)}
            </text>
          </g>
        );
      })}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <text x={pad.left} y={height - 6} fill="var(--text-muted)" fontSize={10}>
        {new Date(series[0]!.t).toLocaleString()}
      </text>
      <text
        x={width - pad.right}
        y={height - 6}
        textAnchor="end"
        fill="var(--text-muted)"
        fontSize={10}
      >
        {new Date(series[series.length - 1]!.t).toLocaleString()}
      </text>
    </svg>
  );
}

export function AdminApisPanel() {
  const [range, setRange] = useState<UsageRange>("1d");

  const usageQuery = useQuery({
    queryKey: ["admin", "api-usage", range],
    queryFn: async () => {
      const res = await apiJson<{
        data: { range: UsageRange; series: SeriesPoint[] };
      }>(`/api/v1/admin/api-usage/summary?range=${range}`);
      return res.data;
    },
    refetchInterval: 30_000,
  });

  const totals = useMemo(() => {
    const series = usageQuery.data?.series ?? [];
    const t = { success: 0, apiFailure: 0, authFailure: 0, accessViolation: 0 };
    for (const p of series) {
      t.success += p.success;
      t.apiFailure += p.apiFailure;
      t.authFailure += p.authFailure;
      t.accessViolation += p.accessViolation;
    }
    return t;
  }, [usageQuery.data]);

  const series = usageQuery.data?.series ?? [];

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        API usage over time. Request logging is active for <code>/api/v1/*</code>.
      </p>

      <div className="admin-toolbar admin-range-toggle" role="group" aria-label="Time range">
        {(["1h", "1d", "1w"] as UsageRange[]).map((r) => (
          <button
            key={r}
            type="button"
            className={`btn small${range === r ? " primary" : " ghost"}`}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="admin-stat-row">
        {CHARTS.map((s) => (
          <div key={s.key} className="admin-stat">
            <span className="admin-stat__swatch" style={{ background: s.color }} />
            <span className="admin-stat__label">{s.label}</span>
            <strong className="admin-stat__value">{totals[s.key]}</strong>
          </div>
        ))}
      </div>

      {usageQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {usageQuery.isError ? (
        <p className="error-text">{(usageQuery.error as Error).message}</p>
      ) : null}

      {usageQuery.data ? (
        <div className="admin-usage-stack">
          <section className="admin-usage-block">
            <h4 className="admin-usage-block__title">
              <span
                className="admin-stat__swatch"
                style={{ background: CHARTS[0]!.color }}
                aria-hidden
              />
              {CHARTS[0]!.label}
              <span className="muted small">({totals.success})</span>
            </h4>
            <UsageChart
              series={series}
              seriesKey="success"
              label={CHARTS[0]!.label}
              color={CHARTS[0]!.color}
            />
          </section>

          {FAILURE_CHARTS.map((chart) => (
            <section key={chart.key} className="admin-usage-block">
              <h4 className="admin-usage-block__title">
                <span
                  className="admin-stat__swatch"
                  style={{ background: chart.color }}
                  aria-hidden
                />
                {chart.label}
                <span className="muted small">({totals[chart.key]})</span>
              </h4>
              <UsageChart
                series={series}
                seriesKey={chart.key}
                label={chart.label}
                color={chart.color}
              />
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
