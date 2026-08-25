import { useMemo } from "react";

export type UsageRange = "1h" | "1d" | "1w" | "1m";

export const USAGE_RANGES: UsageRange[] = ["1h", "1d", "1w", "1m"];

export function AdminUsageChart<T extends { t: string }>({
  series,
  valueOf,
  label,
  color,
  formatY,
}: {
  series: T[];
  valueOf: (point: T) => number;
  label: string;
  color: string;
  formatY?: (value: number) => string;
}) {
  const width = 640;
  const height = 160;
  const pad = { top: 12, right: 12, bottom: 24, left: 56 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const maxY = useMemo(() => {
    let m = 0;
    for (const p of series) {
      m = Math.max(m, valueOf(p));
    }
    return m > 0 ? m : 1;
  }, [series, valueOf]);

  const fmt = formatY ?? ((v: number) => String(Math.round(v)));

  if (series.length === 0) {
    return <p className="muted">No data in this range yet.</p>;
  }

  const n = series.length;
  const xAt = (i: number) => pad.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad.top + innerH - (v / maxY) * innerH;
  const path = series
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(valueOf(p)).toFixed(1)}`)
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
              {fmt(maxY * f)}
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

export function AdminRangeToggle({
  range,
  onChange,
}: {
  range: UsageRange;
  onChange: (next: UsageRange) => void;
}) {
  return (
    <div className="admin-toolbar admin-range-toggle" role="group" aria-label="Time range">
      {USAGE_RANGES.map((r) => (
        <button
          key={r}
          type="button"
          className={`btn small${range === r ? " primary" : " ghost"}`}
          onClick={() => onChange(r)}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
