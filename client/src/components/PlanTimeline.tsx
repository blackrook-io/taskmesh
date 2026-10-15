import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiJson } from "../api/client";
import { buildMeshCard, type MeshCardModel } from "../lib/meshCard";
import type { MeshGraphEdge } from "../lib/meshLayout";
import { glyphStyle, type MeshColorMode, type MeshSignalNode } from "../lib/meshSignals";
import {
  axisTicks,
  barSegments,
  calendarDays,
  columnWidth,
  dateX,
  isWeekend,
  addDays,
  type TimelineZoom,
} from "../lib/planTimeline";

type TimelinePhase = {
  id: number;
  name: string;
  color: string | null;
  sortOrder: number;
};

type TimelineActivity = {
  at: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

type TimelineComment = {
  at: string;
  excerpt: string;
  withUpdate: boolean;
};

export type TimelineRow = {
  key: string;
  entityType: "task" | "todo";
  entityId: number;
  referenceId: string;
  title: string;
  phaseId: number | null;
  parentKey: string | null;
  state: string;
  priority: string;
  progress: number | null;
  dueDate: string | null;
  estimateHours: number | null;
  remainingHours: number;
  start: string;
  end: string;
  startFraction: number;
  endFraction: number;
  actual: boolean;
  marker: "bar" | "bracket" | "unestimated";
  critical: boolean;
  slackDays: number;
  prerequisiteKeys: string[];
  waitingOn: string[];
  listId: number | null;
  projectLabel: string | null;
  createdAt: string | null;
  lastUpdate: TimelineActivity | null;
  lastComment: TimelineComment | null;
};

type TimelineData = {
  anchor: string;
  workdayHours: number;
  criticalPathFinish: string | null;
  cycle: boolean;
  phases: TimelinePhase[];
  rows: TimelineRow[];
};

const LABEL_WIDTH = 220;
const ROW_HEIGHT = 36;
const PHASE_HEIGHT = 28;
const MODES: Array<{ id: MeshColorMode; label: string }> = [
  { id: "type", label: "Type" },
  { id: "state", label: "State" },
  { id: "priority", label: "Priority" },
];
const ZOOMS: Array<{ id: TimelineZoom; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function hoursLabel(row: TimelineRow): string {
  if (row.estimateHours == null) return "Unestimated";
  if (row.remainingHours > 0 && row.remainingHours !== row.estimateHours) {
    return `${row.remainingHours} h remaining of ${row.estimateHours} h`;
  }
  return `${row.estimateHours} h`;
}

function slackLabel(days: number): string {
  if (days <= 0) return "None";
  if (days === 1) return "1 working day";
  return `${days} working days`;
}

function isLate(row: TimelineRow, anchor: string): boolean {
  if (!row.dueDate) return false;
  if (row.end > row.dueDate) return true;
  const open = row.state !== "complete" && row.state !== "canceled" && row.state !== "pending";
  return open && anchor > row.dueDate;
}

function depthOf(row: TimelineRow, byKey: Map<string, TimelineRow>): number {
  let depth = 0;
  let parent = row.parentKey;
  const seen = new Set<string>();
  while (parent && byKey.has(parent) && !seen.has(parent) && depth < 8) {
    seen.add(parent);
    depth += 1;
    parent = byKey.get(parent)?.parentKey ?? null;
  }
  return depth;
}

export function PlanTimeline({ planId }: { planId: number }) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<TimelineZoom>("week");
  const [colorMode, setColorMode] = useState<MeshColorMode>("state");
  const [showCritical, setShowCritical] = useState(false);
  const [card, setCard] = useState<{ key: string; top: number; left: number } | null>(null);
  const query = useQuery({
    queryKey: ["plan-timeline", planId],
    queryFn: async () => {
      const res = await apiJson<{ data: TimelineData }>(`/api/v1/plans/${planId}/timeline`);
      return res.data;
    },
  });

  const data = query.data;
  const layout = useMemo(() => {
    if (!data) return null;
    const dates = [data.anchor, data.criticalPathFinish].filter((date): date is string => date != null);
    for (const row of data.rows) {
      dates.push(row.start, row.end);
      if (row.dueDate) dates.push(row.dueDate);
    }
    const sorted = [...dates].sort();
    const origin = addDays(sorted[0] ?? data.anchor, -1);
    const end = addDays(sorted[sorted.length - 1] ?? data.anchor, 2);
    const dayCount = Math.max(1, calendarDays(origin, end) + 1);
    const natural = dayCount * columnWidth(zoom);
    const plotWidth = Math.max(natural, 640);
    const width = plotWidth / dayCount;
    const phases = new Map(data.phases.map((phase) => [phase.id, phase]));
    const byKey = new Map(data.rows.map((row) => [row.key, row]));
    const lanes: Array<
      | { kind: "phase"; key: string; name: string; color: string | null; y: number }
      | { kind: "row"; row: TimelineRow; y: number }
    > = [];
    let y = 0;
    let lastPhase: number | null = null;
    for (const row of data.rows) {
      if (row.phaseId !== lastPhase) {
        const phase = row.phaseId != null ? phases.get(row.phaseId) : undefined;
        lanes.push({
          kind: "phase",
          key: `phase-${row.phaseId ?? "none"}-${y}`,
          name: phase?.name ?? "Phase",
          color: phase?.color ?? null,
          y,
        });
        y += PHASE_HEIGHT;
        lastPhase = row.phaseId;
      }
      lanes.push({ kind: "row", row, y });
      y += ROW_HEIGHT;
    }
    return { origin, end, width, plotWidth, lanes, bodyHeight: y, byKey };
  }, [data, zoom]);

  const openKey = (key: string) => {
    const row = layout?.byKey.get(key);
    if (!row) return;
    if (row.entityType === "task") {
      navigate(`/tasks?open=${row.entityId}`);
      return;
    }
    if (row.listId != null) navigate(`/todos/${row.listId}?todo=${row.entityId}`);
    else navigate("/todos");
  };

  const showCard = (key: string, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 300);
    setCard({ key, top: rect.bottom + 6, left: Math.max(8, left) });
  };

  const hideCard = (next: EventTarget | null) => {
    if (next instanceof Node && cardRef.current?.contains(next)) return;
    setCard(null);
  };

  if (query.isLoading) return <p className="muted">Loading timeline…</p>;
  if (query.isError) return <p className="plan-board__notice">Could not load the timeline.</p>;
  if (!data || !layout) return null;
  if (data.rows.length === 0) return <p className="muted">No items on this plan.</p>;

  const ticks = axisTicks(layout.origin, layout.end, zoom);
  const weekendXs: number[] = [];
  for (let offset = 0; offset <= calendarDays(layout.origin, layout.end); offset += 1) {
    const date = addDays(layout.origin, offset);
    if (isWeekend(date)) weekendXs.push(offset * layout.width);
  }
  const cardRow = card ? layout.byKey.get(card.key) : undefined;
  const cardModel = cardRow ? meshModel(cardRow, data.rows) : null;

  return (
    <div className="plan-timeline">
      <div className="plan-timeline__tools">
        <div className="plan-board__view" role="group" aria-label="Zoom">
          {ZOOMS.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className="btn"
              aria-pressed={zoom === mode.id}
              onClick={() => setZoom(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <div className="plan-board__view" role="group" aria-label="Color">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className="btn"
              aria-pressed={colorMode === mode.id}
              onClick={() => setColorMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn"
          aria-pressed={showCritical}
          disabled={data.cycle || data.criticalPathFinish == null}
          onClick={() => setShowCritical((current) => !current)}
        >
          Critical path
        </button>
        {data.cycle ? <p className="plan-timeline__note">Dependencies cycle, so there is no critical path.</p> : null}
      </div>
      <div className="plan-timeline__scroll">
        <div className="plan-timeline__chart" style={{ width: LABEL_WIDTH + layout.plotWidth }}>
          <div className="plan-timeline__axis">
            <div className="plan-timeline__label-spacer" />
            <div className="plan-timeline__plot" style={{ width: layout.plotWidth }}>
              {ticks.map((tick) => (
                <span
                  key={tick.date}
                  className="plan-timeline__tick"
                  style={{ left: dateX(tick.date, layout.origin, layout.width) }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
          <div className="plan-timeline__body" style={{ height: layout.bodyHeight }}>
            <div
              className="plan-timeline__shade"
              style={{ left: LABEL_WIDTH, width: layout.plotWidth, height: layout.bodyHeight }}
            >
              {weekendXs.map((x) => (
                <span key={x} className="plan-timeline__weekend" style={{ left: x, width: layout.width }} />
              ))}
            </div>
            <div
              className="plan-timeline__today"
              style={{ left: LABEL_WIDTH + dateX(data.anchor, layout.origin, layout.width) }}
              title="Today"
            />
            <svg
              className="plan-timeline__wires"
              width={layout.plotWidth}
              height={layout.bodyHeight}
              style={{ left: LABEL_WIDTH }}
              aria-hidden="true"
            >
              {layout.lanes.flatMap((lane) => {
                if (lane.kind !== "row") return [];
                const target = barSegments(spanOf(lane.row), layout.origin, layout.width)[0];
                if (!target) return [];
                return lane.row.prerequisiteKeys.flatMap((key) => {
                  const predLane = layout.lanes.find((item) => item.kind === "row" && item.row.key === key);
                  if (!predLane || predLane.kind !== "row") return [];
                  const predSegments = barSegments(spanOf(predLane.row), layout.origin, layout.width);
                  const source = predSegments[predSegments.length - 1];
                  if (!source) return [];
                  const x1 = source.x + source.width;
                  const y1 = predLane.y + ROW_HEIGHT / 2;
                  const x2 = target.x;
                  const y2 = lane.y + ROW_HEIGHT / 2;
                  const mid = x1 + Math.max(12, (x2 - x1) / 2);
                  return [
                    <path
                      key={`${key}->${lane.row.key}`}
                      d={`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`}
                      className="plan-timeline__wire"
                    />,
                  ];
                });
              })}
            </svg>
            {layout.lanes.map((lane) => {
              if (lane.kind === "phase") {
                return (
                  <div key={lane.key} className="plan-timeline__phase">
                    <span className="plan-timeline__phase-name">
                      {lane.color ? (
                        <i className="plan-board__swatch" style={{ background: lane.color }} />
                      ) : null}
                      {lane.name}
                    </span>
                  </div>
                );
              }
              const row = lane.row;
              const segments = barSegments(spanOf(row), layout.origin, layout.width);
              const totalWidth = segments.reduce((sum, segment) => sum + segment.width, 0);
              const ink = glyphStyle(colorMode, signalOf(row));
              const labelOutside = totalWidth < 56;
              const dim = showCritical && !row.critical;
              return (
                <div key={row.key} className="plan-timeline__lane">
                  <div className="plan-timeline__name" style={{ paddingLeft: 8 + depthOf(row, layout.byKey) * 14 }}>
                    <span className="plan-timeline__title">{row.title}</span>
                  </div>
                  <div className="plan-timeline__plot" style={{ width: layout.plotWidth }}>
                    <button
                      type="button"
                      className="plan-timeline__hit"
                      aria-label={`${row.referenceId} ${row.title}, ${dayLabel(row.start)} to ${dayLabel(row.end)}`}
                      onClick={() => openKey(row.key)}
                      onFocus={(event) => showCard(row.key, event.currentTarget)}
                      onBlur={(event) => hideCard(event.relatedTarget)}
                      onPointerEnter={(event) => showCard(row.key, event.currentTarget)}
                      onPointerLeave={(event) => hideCard(event.relatedTarget)}
                    >
                      {segments.map((segment, index) => (
                        <span
                          key={`${row.key}-${index}`}
                          className={`plan-timeline__bar plan-timeline__bar--${row.marker}${
                            row.critical ? " plan-timeline__bar--critical" : ""
                          }${dim ? " plan-timeline__bar--dim" : ""}`}
                          style={{
                            left: segment.x,
                            width: Math.max(segment.width, 4),
                            color: ink.color,
                            background: row.marker === "bar" ? ink.color : undefined,
                          }}
                        >
                          {index === 0 && !labelOutside ? row.referenceId : null}
                        </span>
                      ))}
                      {labelOutside && segments[0] ? (
                        <span
                          className="plan-timeline__outside"
                          style={{ left: (segments[segments.length - 1]?.x ?? 0) + (segments[segments.length - 1]?.width ?? 0) + 6 }}
                        >
                          {row.referenceId}
                        </span>
                      ) : null}
                    </button>
                    {row.dueDate ? (
                      <span
                        className={`plan-timeline__due${isLate(row, data.anchor) ? " plan-timeline__due--late" : ""}`}
                        style={{ left: dateX(row.dueDate, layout.origin, layout.width) }}
                        title={`Due ${dayLabel(row.dueDate)}`}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {card && cardRow && cardModel ? (
        <div
          ref={cardRef}
          className="mesh-card plan-timeline__card"
          style={{ position: "fixed", top: card.top, left: card.left }}
          onPointerLeave={() => setCard(null)}
        >
          <CardBody model={cardModel} onOpen={openKey} />
          <dl className="plan-timeline__schedule">
            <dt>Hours</dt>
            <dd>{hoursLabel(cardRow)}</dd>
            <dt>Scheduled start</dt>
            <dd>{dayLabel(cardRow.start)}</dd>
            <dt>Scheduled end</dt>
            <dd>{dayLabel(cardRow.end)}</dd>
            <dt>Slack</dt>
            <dd>{slackLabel(cardRow.slackDays)}</dd>
            <dt>Waiting on</dt>
            <dd>
              {cardRow.waitingOn.length === 0
                ? "Nothing"
                : cardRow.waitingOn
                    .map((key) => {
                      const other = layout.byKey.get(key);
                      return other ? `${other.referenceId} ${other.title}` : key;
                    })
                    .join(", ")}
            </dd>
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function spanOf(row: TimelineRow) {
  return {
    start: row.start,
    end: row.end,
    startFraction: row.startFraction,
    endFraction: row.endFraction,
    actual: row.actual,
  };
}

function signalOf(row: TimelineRow): MeshSignalNode {
  return {
    key: row.key,
    type: row.entityType,
    state: row.state,
    priority: row.priority,
    progress: row.progress,
    dueDate: row.dueDate,
    createdAt: row.createdAt,
  };
}

function meshModel(row: TimelineRow, rows: TimelineRow[]): MeshCardModel {
  const nodes = rows.map((item) => ({
    key: item.key,
    type: item.entityType,
    state: item.state,
    priority: item.priority,
    progress: item.progress,
    dueDate: item.dueDate,
    createdAt: item.createdAt,
    signalAt: item.lastUpdate?.at ?? item.lastComment?.at ?? item.createdAt,
    referenceId: item.referenceId,
    title: item.title,
    projectLabel: item.projectLabel,
    lastUpdate: item.lastUpdate,
    lastComment: item.lastComment,
  }));
  const edges: MeshGraphEdge[] = [];
  for (const item of rows) {
    for (const prerequisite of item.prerequisiteKeys) {
      edges.push({ source: item.key, target: prerequisite, relation: "depends_on" });
    }
    if (item.parentKey) edges.push({ source: item.key, target: item.parentKey, relation: "child_of" });
  }
  const model = buildMeshCard({
    node: nodes.find((node) => node.key === row.key) ?? nodes[0]!,
    nodes,
    edges,
    today: new Date(),
    staleDays: 30,
    isFocus: false,
  });
  return { ...model, hint: "Click to open this record." };
}

function CardBody({ model, onOpen }: { model: MeshCardModel; onOpen: (key: string) => void }) {
  return (
    <>
      <div className="mesh-card__eyebrow">
        <span className="mesh-card__type">{model.typeLabel}</span>
        {model.referenceId ? <span>{model.referenceId}</span> : null}
      </div>
      <h3>{model.title}</h3>
      {model.stateLabel || model.priorityLabel ? (
        <div className="mesh-card__pills">
          {model.stateLabel ? <span className="mesh-card__pill">{model.stateLabel}</span> : null}
          {model.priorityLabel ? <span className="mesh-card__pill">{model.priorityLabel}</span> : null}
        </div>
      ) : null}
      {model.rows.length > 0 ? (
        <dl>
          {model.rows.map((item) => (
            <Fragment key={item.label}>
              <dt>{item.label}</dt>
              <dd className={item.tone ? `mesh-card__${item.tone}` : undefined}>{item.value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
      {model.dependencies.map((list) => (
        <div key={list.label} className="mesh-card__deps">
          <p className="mesh-card__deps-label">{list.label}</p>
          <ul className="mesh-card__deps-list">
            {list.entries.map((entry) => (
              <li key={entry.key}>
                <button type="button" className="mesh-card__dep" onClick={() => onOpen(entry.key)}>
                  <span className="mesh-card__dep-name">
                    {entry.referenceId} {entry.title}
                  </span>
                  {entry.stateLabel ? <span className="mesh-card__pill">{entry.stateLabel}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
