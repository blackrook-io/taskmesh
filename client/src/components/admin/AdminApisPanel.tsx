import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../../api/client";
import {
  AdminRangeToggle,
  AdminUsageChart,
  type UsageRange,
} from "./AdminUsageChart";

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

const FAILURE_CHARTS = CHARTS.filter((c) => c.key !== "success");

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
  const valueOf = useCallback(
    (key: SeriesKey) => (p: SeriesPoint) => p[key],
    [],
  );

  return (
    <div className="settings-panel admin-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        API usage over time. Request logging is active for <code>/api/v1/*</code>.
      </p>

      <AdminRangeToggle range={range} onChange={setRange} />

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
            <AdminUsageChart
              series={series}
              valueOf={valueOf("success")}
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
              <AdminUsageChart
                series={series}
                valueOf={valueOf(chart.key)}
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
