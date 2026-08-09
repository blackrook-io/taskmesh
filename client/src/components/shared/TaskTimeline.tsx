import { useMemo, useState, type MouseEvent, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiJson } from "../../api/client";
import {
  taskPriorityClass,
  taskStateClass,
  type TaskPriority,
  type TaskState,
} from "../../lib/taskFields";
import {
  buildTaskTimelines,
  formatTimelineElapsed,
  formatTimelineWhen,
  layoutTimelinePositions,
  timelineValueLabel,
  type TimelineKind,
  type TimelineLine,
  type TimelineNode,
} from "../../lib/taskTimeline";
import type { Task, TaskActivityEntry } from "../../types";

type TipState = {
  node: TimelineNode;
  prev: TimelineNode | null;
  kind: TimelineKind;
  x: number;
  y: number;
} | null;

function nodeToneClass(kind: TimelineKind, value: string): string {
  if (kind === "state") {
    return taskStateClass("task-timeline__tone", value as TaskState);
  }
  return taskPriorityClass("task-timeline__tone", value as TaskPriority);
}

function segmentClass(kind: TimelineKind, value: string): string {
  if (kind === "state") {
    return taskStateClass("task-timeline__seg", value as TaskState);
  }
  return taskPriorityClass("task-timeline__seg", value as TaskPriority);
}

function whoLabel(node: TimelineNode): string {
  return node.by?.displayName ?? "Unknown";
}

function whatLabel(kind: TimelineKind, node: TimelineNode): string {
  if (node.role === "creation") {
    return `Created (${timelineValueLabel(kind, node.value)})`;
  }
  if (node.role === "anchor" && node.from == null) {
    return timelineValueLabel(kind, node.value);
  }
  if (node.from != null) {
    return `${timelineValueLabel(kind, node.from)} → ${timelineValueLabel(kind, node.value)}`;
  }
  return timelineValueLabel(kind, node.value);
}

function TimelineRow({
  label,
  line,
  onTip,
}: {
  label: string;
  line: TimelineLine;
  onTip: (tip: TipState) => void;
}) {
  const positions = layoutTimelinePositions(line.nodes.map((n) => n.at));

  const showTip = (
    node: TimelineNode,
    index: number,
    clientX: number,
    clientY: number,
  ) => {
    onTip({
      node,
      prev: index > 0 ? line.nodes[index - 1]! : null,
      kind: line.kind,
      x: clientX,
      y: clientY,
    });
  };

  return (
    <div className="task-timeline__row">
      <div className="task-timeline__label muted">{label}</div>
      <div className="task-timeline__track" role="list" aria-label={`${label} timeline`}>
        {line.nodes.length > 1
          ? line.nodes.slice(0, -1).map((node, i) => {
              const left = positions[i]! * 100;
              const right = positions[i + 1]! * 100;
              return (
                <div
                  key={`seg-${node.id}`}
                  className={segmentClass(line.kind, node.value)}
                  style={{ left: `${left}%`, width: `${Math.max(right - left, 0)}%` }}
                  aria-hidden
                />
              );
            })
          : (
            <div
              className={segmentClass(line.kind, line.nodes[0]!.value)}
              style={{ left: "10%", width: "80%" }}
              aria-hidden
            />
          )}
        {line.nodes.map((node, i) => {
          const left = positions[i]! * 100;
          return (
            <button
              key={node.id}
              type="button"
              role="listitem"
              className={`task-timeline__node ${nodeToneClass(line.kind, node.value)}`}
              style={{ left: `${left}%` }}
              aria-label={whatLabel(line.kind, node)}
              onMouseEnter={(e: MouseEvent) => showTip(node, i, e.clientX, e.clientY)}
              onMouseMove={(e: MouseEvent) => showTip(node, i, e.clientX, e.clientY)}
              onMouseLeave={() => onTip(null)}
              onFocus={(e) => {
                const r = (e.target as HTMLElement).getBoundingClientRect();
                showTip(node, i, r.left + r.width / 2, r.top);
              }}
              onBlur={() => onTip(null)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Escape") onTip(null);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function TimelineTooltip({ tip }: { tip: TipState }) {
  if (!tip) return null;
  const { node, prev, kind, x, y } = tip;
  const elapsed =
    prev != null ? formatTimelineElapsed(prev.at, node.at) : null;

  // Keep tooltip inside viewport roughly.
  const left = Math.min(Math.max(12, x + 14), window.innerWidth - 260);
  const top = Math.min(Math.max(12, y + 16), window.innerHeight - 120);

  return (
    <div
      className="task-timeline__tooltip"
      style={{ left, top }}
      role="tooltip"
    >
      <div className="task-timeline__tooltip-row">
        <span className="muted">Who</span>
        <span>{whoLabel(node)}</span>
      </div>
      <div className="task-timeline__tooltip-row">
        <span className="muted">When</span>
        <span>{formatTimelineWhen(node.at)}</span>
      </div>
      <div className="task-timeline__tooltip-row">
        <span className="muted">What</span>
        <span>{whatLabel(kind, node)}</span>
      </div>
      {elapsed ? (
        <div className="task-timeline__tooltip-row">
          <span className="muted">Elapsed</span>
          <span>{elapsed}</span>
        </div>
      ) : null}
    </div>
  );
}

export function TaskTimeline({ task }: { task: Task }) {
  const [tip, setTip] = useState<TipState>(null);

  const activityQuery = useQuery({
    queryKey: ["task-activity", task.id],
    queryFn: async () => {
      const res = await apiJson<{ data: TaskActivityEntry[] }>(
        `/api/v1/tasks/${task.id}/activity`,
      );
      return res.data;
    },
  });

  const lines = useMemo(() => {
    const entries = activityQuery.data ?? [];
    return buildTaskTimelines(task, entries);
  }, [task, activityQuery.data]);

  return (
    <div className="task-timeline" aria-label="Task timeline">
      <TimelineRow label="State" line={lines.state} onTip={setTip} />
      <TimelineRow label="Priority" line={lines.priority} onTip={setTip} />
      {activityQuery.isLoading ? (
        <p className="task-timeline__loading muted">Loading timeline…</p>
      ) : null}
      <TimelineTooltip tip={tip} />
    </div>
  );
}
