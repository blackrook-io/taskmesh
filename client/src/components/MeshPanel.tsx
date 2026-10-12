import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ViewportPortal,
  useReactFlow,
  useStore,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import "@xyflow/react/dist/style.css";
import { apiJson } from "../api/client";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  MESH_APPEARANCE_DEFAULTS,
  meshAppearanceStyle,
  normalizeMeshAppearance,
  type MeshAppearance,
} from "../lib/meshAppearance";
import { MeshShape } from "./MeshShape";
import {
  buildMeshCard,
  buildMeshSuggestionCard,
  type MeshCardModel,
  type MeshSuggestionCardModel,
} from "../lib/meshCard";
import { isEntityType, type EntityType } from "../lib/entityType";
import { filterMeshGraph } from "../lib/meshFilters";
import { applyMeshPins, meshPinsInGraph, type MeshPin } from "../lib/meshPins";
import { formatEntityRef } from "../lib/entityRef";
import { layoutMeshPlan } from "../lib/meshPlanLayout";
import {
  layoutMesh,
  meshCorridorPoints,
  meshOrthogonalPath,
  meshRoundedPolyline,
  type MeshCorridor,
  type MeshGraphEdge,
  type MeshGraphNode,
  type MeshGroup,
  type MeshLayoutNode,
  type MeshSuggestion,
} from "../lib/meshLayout";
import {
  glyphStyle,
  hiddenOverdueCounts,
  isStale,
  schedule,
  stateAppearance,
  type MeshColorMode,
} from "../lib/meshSignals";
import type { Project } from "../types";

type GraphPayload = {
  nodes: MeshGraphNode[];
  edges: MeshGraphEdge[];
  truncated: boolean;
};

type MeshNodeData = {
  title: string;
  referenceId: string | null;
  projectLabel: string | null;
  type: string;
  role: MeshLayoutNode["role"];
  planMark: MeshLayoutNode["planMark"];
  color: string;
  hollow: boolean;
  progress: number | null;
  priority: string | null;
  schedule: "none" | "ok" | "overdue" | "risk";
  stale: boolean;
  hiddenOver: number;
  pulse: boolean;
  x: number;
  y: number;
  enterFrom: { x: number; y: number } | null;
  reduceMotion: boolean;
  cardText: string;
  group: MeshGroup | null;
  onOpen: (key: string) => void;
  onToggleGroup: (key: string) => void;
  onPointerEnter: (key: string) => void;
  onPointerLeave: () => void;
  onFocusNode: (key: string) => void;
  onBlurNode: () => void;
  onHot: (key: string | null) => void;
  armTouch: (key: string) => void;
  consumeTouch: (key: string) => boolean;
};

const COLOR_MODES: { id: MeshColorMode; label: string }[] = [
  { id: "type", label: "Type" },
  { id: "state", label: "State" },
  { id: "priority", label: "Priority" },
];

const LEGEND_SHAPES: { type: string; label: string }[] = [
  { type: "project", label: "Project" },
  { type: "todo_list", label: "ToDo List" },
  { type: "task", label: "Task" },
  { type: "todo", label: "ToDo" },
  { type: "document", label: "Document" },
  { type: "idea", label: "Idea" },
  { type: "board", label: "Board" },
  { type: "canvas", label: "Canvas" },
  { type: "wiki_node", label: "Wiki" },
  { type: "image_board", label: "Image board" },
];

type MeshRelations = {
  references: boolean;
  dependsOn: boolean;
  suggestions: boolean;
};

const EMPTY_SUGGESTIONS: readonly MeshSuggestion[] = [];
const EMPTY_IDS: ReadonlySet<string> = new Set();

function readRelations(): MeshRelations {
  const fallback: MeshRelations = { references: true, dependsOn: true, suggestions: true };
  try {
    const raw = localStorage.getItem("mesh-relations");
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<MeshRelations>;
    if (typeof parsed !== "object" || parsed == null) return fallback;
    return {
      references: parsed.references !== false,
      dependsOn: parsed.dependsOn !== false,
      suggestions: parsed.suggestions !== false,
    };
  } catch {
    return fallback;
  }
}

function suggestionIdentity(item: MeshSuggestion): string {
  return `${item.sourceKey}|${item.targetKey}|${item.confidence}|${item.reason}`;
}

function parseEntityKey(key: string): { entityType: EntityType; id: number } | null {
  const colon = key.indexOf(":");
  if (colon <= 0) return null;
  const entityType = key.slice(0, colon);
  const id = Number(key.slice(colon + 1));
  if (!isEntityType(entityType) || !Number.isInteger(id) || id <= 0) return null;
  return { entityType, id };
}

type MeshDepth = 1 | 2 | 3;

function readDepth(): MeshDepth {
  try {
    const stored = localStorage.getItem("mesh-depth");
    if (stored === "1" || stored === "2" || stored === "3") return Number(stored) as MeshDepth;
  } catch {
    /* private browsing */
  }
  return 3;
}

function readHideDone(): boolean {
  try {
    return localStorage.getItem("mesh-hide-done") === "1";
  } catch {
    return false;
  }
}

function readHiddenTypes(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem("mesh-hidden-types");
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string" && isEntityType(item)));
  } catch {
    return new Set();
  }
}

function readColorMode(): MeshColorMode {
  try {
    const stored = localStorage.getItem("mesh-color");
    if (stored === "state" || stored === "priority" || stored === "type") return stored;
  } catch {
    /* private browsing */
  }
  return "type";
}

function legendColors(mode: MeshColorMode): { color: string; label: string; hollow?: boolean }[] {
  if (mode === "state") {
    return [
      { color: "var(--task-state-draft)", label: "Draft" },
      { color: "var(--task-state-ready)", label: "Ready" },
      { color: "var(--task-state-progress)", label: "In Progress", hollow: true },
      { color: "var(--task-state-pending)", label: "Pending" },
      { color: "var(--task-state-done)", label: "Complete", hollow: true },
      { color: "var(--task-state-hold)", label: "On Hold" },
      { color: "var(--task-state-canceled)", label: "Canceled" },
    ];
  }
  if (mode === "priority") {
    return [
      { color: "var(--border)", label: "None", hollow: true },
      { color: "var(--task-priority-low)", label: "Low" },
      { color: "var(--task-priority-medium)", label: "Medium" },
      { color: "var(--task-priority-high)", label: "High" },
      { color: "var(--task-priority-urgent)", label: "Urgent" },
    ];
  }
  return LEGEND_SHAPES.map((item) => ({ color: `var(--mesh-type-${item.type})`, label: item.label }));
}

function meshChrome(appearance: MeshAppearance): { staleDays: number; pulse: boolean } {
  return { staleDays: appearance.staleDays, pulse: appearance.overduePulse };
}

type MeshFlowNode = Node<MeshNodeData, "mesh">;

const MESH_HOT_MARKER = "url('#mesh-hot-arrow')";

function applyMeshNodeTitle(button: HTMLButtonElement, cardKey: string | null) {
  const titleEl = button.querySelector(".mesh-title");
  if (!(titleEl instanceof HTMLElement)) return;
  const key = button.getAttribute("data-mesh-key");
  const truncated =
    titleEl.scrollHeight > titleEl.clientHeight + 1 || titleEl.scrollWidth > titleEl.clientWidth + 1;
  if (key !== cardKey && truncated) button.setAttribute("title", titleEl.textContent ?? "");
  else button.removeAttribute("title");
}

function paintMeshHot(from: Element, key: string | null) {
  const canvas = from.closest(".mesh-canvas");
  if (!canvas) return;
  canvas.classList.toggle("mesh-canvas--focusing", key != null);
  const keep = new Set<string>();
  if (key) keep.add(key);
  canvas.querySelectorAll(".react-flow__edge").forEach((edge) => {
    const mark = edge.querySelector("[data-source]");
    const source = mark?.getAttribute("data-source");
    const target = mark?.getAttribute("data-target");
    const hot = key != null && (source === key || target === key);
    if (hot) {
      if (source) keep.add(source);
      if (target) keep.add(target);
    }
    edge.classList.toggle("mesh-edge--hot", hot);
    const svg = edge.parentElement;
    if (svg instanceof SVGSVGElement) svg.style.zIndex = hot ? "1" : "0";
    const path = edge.querySelector(".react-flow__edge-path");
    if (!(path instanceof SVGPathElement)) return;
    if (hot) {
      const marker = path.getAttribute("marker-end");
      if (marker && marker !== MESH_HOT_MARKER) {
        path.setAttribute("data-marker-end", marker);
        path.setAttribute("marker-end", MESH_HOT_MARKER);
      }
    } else {
      const saved = path.getAttribute("data-marker-end");
      if (saved) {
        path.setAttribute("marker-end", saved);
        path.removeAttribute("data-marker-end");
      }
    }
  });
  canvas.querySelectorAll(".react-flow__node").forEach((node) => {
    const id = node.querySelector("[data-mesh-key]")?.getAttribute("data-mesh-key");
    node.classList.toggle("mesh-node--keep", id != null && keep.has(id));
  });
}

function MeshEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const info = data as
    | {
        sourceOffset?: number;
        targetOffset?: number;
        laneX?: number;
        corridor?: MeshCorridor | null;
        trunkCount?: number | null;
        trunkPath?: { x: number; y: number }[] | null;
      }
    | undefined;
  const sy = sourceY + (info?.sourceOffset ?? 0);
  const ty = targetY + (info?.targetOffset ?? 0);
  const path = info?.trunkPath
    ? meshRoundedPolyline(info.trunkPath)
    : info?.corridor
      ? meshRoundedPolyline(meshCorridorPoints(sourceX, sy, targetX, ty, info.corridor))
      : meshOrthogonalPath(sourceX, sy, targetX, ty, info?.laneX ?? sourceX + 20);
  const badge = info?.trunkCount && info.trunkPath ? info.trunkPath[info.trunkPath.length - 1] : null;
  return (
    <>
      <path d={path} className="mesh-edge__halo" fill="none" />
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {badge && info?.trunkCount ? (
        <g className="mesh-trunk-badge" transform={`translate(${badge.x - 18}, ${badge.y})`}>
          <circle r="9" />
          <text>{info.trunkCount}</text>
        </g>
      ) : null}
      <g data-source={info?.trunkCount ? "" : source} data-target={target} />
    </>
  );
}

function cardDescId(key: string): string {
  return `mesh-card-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/** Past the 20px line step, so the card does not cover the lines on this record. */
const MESH_CARD_GAP = 32;

function placeMeshCard(canvas: HTMLElement, card: HTMLElement, key: string): boolean {
  const node = canvas.querySelector(`[data-mesh-key="${CSS.escape(key)}"]`);
  if (!(node instanceof HTMLElement)) return false;
  const host = canvas.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const zoom = node.offsetWidth > 0 ? box.width / node.offsetWidth : 1;
  const gap = MESH_CARD_GAP * (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
  let left = box.right - host.left + gap;
  if (left + width > host.width - 8) left = box.left - host.left - width - gap;
  left = Math.max(8, Math.min(left, host.width - width - 8));
  let top = box.top - host.top - 8;
  top = Math.max(8, Math.min(top, host.height - height - 8));
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  return true;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function MeshHoverCard({
  model,
  cardRef,
  onPointerEnter,
  onPointerLeave,
}: {
  model: MeshCardModel;
  cardRef: RefObject<HTMLDivElement | null>;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const stateInk = stateAppearance(model.state);
  return (
    <div
      ref={cardRef}
      className="mesh-card"
      aria-hidden="true"
      style={{ visibility: "hidden" }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="mesh-card__eyebrow">
        <span className="mesh-card__type" style={{ color: `var(--mesh-type-${model.type})` }}>
          {model.typeLabel}
        </span>
        {model.referenceId ? <span>{model.referenceId}</span> : null}
      </div>
      <h3>{model.title}</h3>
      {model.stateLabel || model.priorityLabel ? (
        <div className="mesh-card__pills">
          {model.stateLabel ? (
            <span className="mesh-card__pill" style={{ color: stateInk.color }}>
              {model.stateLabel}
            </span>
          ) : null}
          {model.priorityLabel && model.priority ? (
            <span
              className="mesh-card__pill"
              style={{ color: `var(--task-priority-${model.priority})` }}
            >
              {model.priorityLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      {model.progress != null ? (
        <div className="mesh-card__bar" aria-hidden="true">
          <i style={{ width: `${Math.max(0, Math.min(100, model.progress))}%` }} />
        </div>
      ) : null}
      {model.rows.length > 0 ? (
        <dl>
          {model.rows.map((row) => (
            <Fragment key={row.label}>
              <dt>{row.label}</dt>
              <dd className={row.tone ? `mesh-card__${row.tone}` : undefined}>{row.value}</dd>
              {row.quote ? <dd className="mesh-card__quote">{row.quote}</dd> : null}
            </Fragment>
          ))}
        </dl>
      ) : null}
      <p className="mesh-card__hint">{model.hint}</p>
    </div>
  );
}

function MeshSuggestionCard({
  model,
  cardRef,
  pending,
  error,
  onAccept,
  onDismiss,
  onPointerEnter,
  onPointerLeave,
}: {
  model: MeshSuggestionCardModel;
  cardRef: RefObject<HTMLDivElement | null>;
  pending: boolean;
  error: string | null;
  onAccept: (targetKey: string) => void;
  onDismiss: (item: { targetKey: string; confidence: number; reason: string }) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  return (
    <div
      ref={cardRef}
      className="mesh-card mesh-card--suggestion"
      style={{ visibility: "hidden" }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="mesh-card__eyebrow">
        <span className="mesh-card__type" style={{ color: `var(--mesh-type-${model.type})` }}>
          {model.typeLabel}
        </span>
        {model.referenceId ? <span>{model.referenceId}</span> : null}
        <span className="mesh-card__ai">AI suggestion</span>
      </div>
      <h3>{model.title}</h3>
      <p className="mesh-card__note">{model.projectNote}</p>
      {model.items.map((item) => (
        <div key={`${item.targetKey}:${item.confidence}:${item.reason}`} className="mesh-card__suggest">
          <p className="mesh-card__target">Link to {item.targetLabel}</p>
          <div
            className="mesh-card__bar mesh-card__bar--ai"
            aria-label={`${item.confidence}% match`}
          >
            <i style={{ width: `${Math.max(0, Math.min(100, item.confidence))}%` }} />
          </div>
          <p className="mesh-card__meta">
            {item.confidence}% match · {item.reason}
          </p>
          <div className="mesh-card__actions">
            <button
              type="button"
              className="btn small primary"
              disabled={pending}
              onClick={() => onAccept(item.targetKey)}
            >
              Accept link
            </button>
            <button
              type="button"
              className="btn small ghost"
              disabled={pending}
              onClick={() => onDismiss(item)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
      {error ? (
        <p className="mesh-card__danger" role="alert">
          {error}
        </p>
      ) : null}
      <p className="mesh-card__hint">{model.hint}</p>
    </div>
  );
}

function MeshRecordNode({ id, data }: NodeProps<MeshFlowNode>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const played = useRef(false);
  useLayoutEffect(() => {
    const button = buttonRef.current;
    const titleEl = titleRef.current;
    if (!button || !titleEl) return;
    const apply = () => {
      const canvas = button.closest(".mesh-canvas");
      const open = canvas instanceof HTMLElement ? (canvas.dataset.meshCard ?? null) : null;
      applyMeshNodeTitle(button, open);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(titleEl);
    return () => observer.disconnect();
  }, [data.title]);
  useLayoutEffect(() => {
    if (played.current || data.reduceMotion || !data.enterFrom) return;
    const host = buttonRef.current?.closest(".react-flow__node");
    if (!(host instanceof HTMLElement)) return;
    played.current = true;
    const dx = data.enterFrom.x - data.x;
    const dy = data.enterFrom.y - data.y;
    host.animate(
      [
        {
          transform: `translate(${data.x + dx}px, ${data.y + dy}px) scale(0.2)`,
          opacity: 0.15,
        },
        { transform: `translate(${data.x}px, ${data.y}px) scale(1)`, opacity: 1 },
      ],
      { duration: 500, easing: "ease-out" },
    );
  }, [data.enterFrom, data.reduceMotion, data.x, data.y]);

  const label = data.group
    ? `${data.title}, ${data.group.expanded ? "expanded" : "collapsed"} group`
    : [
        data.referenceId,
        data.role === "suggestion" ? "AI suggestion" : null,
        data.planMark === "blocked" ? "blocked" : data.planMark === "next" ? "next" : null,
        data.title,
        data.projectLabel,
        data.role === "suggestion" ? null : data.schedule === "overdue" ? "overdue" : null,
        data.role === "suggestion" ? null : data.stale ? "stale" : null,
      ]
        .filter(Boolean)
        .join(", ");
  const suggested = data.role === "suggestion";
  const ring = suggested || data.progress == null ? null : Math.max(0, Math.min(100, data.progress));
  return (
    <>
      <Handle id="t" type="target" position={Position.Top} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="l-out" type="source" position={Position.Left} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="r-in" type="target" position={Position.Right} />
      <button
        ref={buttonRef}
        type="button"
        className={[
          `mesh-node mesh-node--${data.role}`,
          data.group ? "mesh-node--group" : "",
          data.planMark ? `mesh-node--${data.planMark}` : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-mesh-key={id}
        aria-label={label}
        aria-expanded={data.group ? data.group.expanded : undefined}
        aria-describedby={data.group ? undefined : cardDescId(id)}
        onPointerDown={(event) => {
          if (data.group) return;
          if (event.pointerType === "touch") data.armTouch(id);
        }}
        onClick={(event) => {
          if (data.group) {
            data.onToggleGroup(id);
            return;
          }
          if (suggested) {
            data.onFocusNode(id);
            return;
          }
          if (data.consumeTouch(id)) {
            event.preventDefault();
            return;
          }
          data.onOpen(id);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (data.group) {
            data.onToggleGroup(id);
            return;
          }
          if (suggested) {
            data.onFocusNode(id);
            return;
          }
          data.onOpen(id);
        }}
        onMouseEnter={(event) => {
          paintMeshHot(event.currentTarget, id);
          data.onHot(id);
          if (!data.group) data.onPointerEnter(id);
        }}
        onMouseLeave={(event) => {
          const next = event.relatedTarget;
          const ontoCard = next instanceof Element && next.closest(".mesh-card") != null;
          const active = document.activeElement;
          const focused =
            active instanceof HTMLElement
              ? (active.closest(".mesh-node")?.getAttribute("data-mesh-key") ?? null)
              : null;
          const canvas = event.currentTarget.closest(".mesh-canvas");
          const keepFocused = focused && active instanceof Node && canvas?.contains(active) ? focused : null;
          const keep = ontoCard ? id : keepFocused;
          paintMeshHot(event.currentTarget, keep);
          data.onHot(keep);
          data.onPointerLeave();
        }}
        onFocus={(event) => {
          paintMeshHot(event.currentTarget, id);
          data.onHot(id);
          if (!data.group) data.onFocusNode(id);
        }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          const nextKey =
            next instanceof Element
              ? (next.closest(".mesh-node")?.getAttribute("data-mesh-key") ?? null)
              : null;
          if (nextKey) {
            paintMeshHot(event.currentTarget, nextKey);
            data.onHot(nextKey);
          } else if (event.currentTarget.matches(":hover")) {
            paintMeshHot(event.currentTarget, id);
            data.onHot(id);
          } else {
            paintMeshHot(event.currentTarget, null);
            data.onHot(null);
          }
          data.onBlurNode();
        }}
      >
        {data.group ? <span className="mesh-group-box" aria-hidden /> : null}
        <span id={cardDescId(id)} className="sr-only">
          {data.cardText}
        </span>
        <span className="mesh-mark">
          {!suggested && data.schedule === "overdue" ? (
            <span className={data.pulse ? "mesh-ring mesh-ring--overdue mesh-ring--pulse" : "mesh-ring mesh-ring--overdue"} />
          ) : null}
          {!suggested && data.schedule === "risk" ? <span className="mesh-ring mesh-ring--risk" /> : null}
          {ring != null ? (
            <svg className="mesh-progress" viewBox="0 0 36 36" aria-hidden>
              <circle cx="18" cy="18" r="15" className="mesh-progress__track" />
              <circle
                cx="18"
                cy="18"
                r="15"
                className="mesh-progress__value"
                strokeDasharray={`${(94.2 * ring) / 100} 94.2`}
              />
            </svg>
          ) : null}
          <MeshShape type={data.type} color={data.color} hollow={data.hollow} />
          {!suggested && (data.priority === "urgent" || data.priority === "high") ? (
            <span className={`mesh-badge mesh-badge--${data.priority}`} aria-hidden>
              {data.priority === "urgent" ? "!!" : "!"}
            </span>
          ) : null}
          {!suggested && data.stale ? (
            <svg className="mesh-stale" viewBox="0 0 12 12" aria-hidden>
              <circle cx="6" cy="6" r="5" />
              <path d="M6 3.4 V6.2 L8 7.3" />
            </svg>
          ) : null}
          {!suggested && data.hiddenOver > 0 ? (
            <span className="mesh-count" aria-hidden>
              {data.hiddenOver}
            </span>
          ) : null}
        </span>
        <span className="mesh-copy">
          <span ref={titleRef} className="mesh-title">{data.title}</span>
          {data.referenceId || data.projectLabel ? (
            <span className="mesh-ref">
              {data.referenceId}
              {data.referenceId && data.projectLabel ? " · " : null}
              {data.projectLabel}
            </span>
          ) : null}
        </span>
      </button>
    </>
  );
}

const nodeTypes = { mesh: MeshRecordNode };
const edgeTypes = { mesh: MeshEdge };
/** Gap from the canvas top to the highest record when a focus opens. */
const MESH_FRAME_TOP = 36;

function FrameFocus({
  focusKey,
  x,
  top,
}: {
  focusKey: string;
  x: number;
  top: number;
}) {
  const { setCenter } = useReactFlow();
  const height = useStore((state) => state.height);
  const framedFor = useRef("");
  useLayoutEffect(() => {
    if (height <= 0) return;
    const token = `${focusKey}:${Math.round(x)}:${Math.round(top)}`;
    if (framedFor.current === token) return;
    framedFor.current = token;
    const reduce = prefersReducedMotion();
    const frame = requestAnimationFrame(() => {
      void setCenter(x + 80, top + height / 2 - MESH_FRAME_TOP, {
        zoom: 1,
        duration: reduce ? 0 : 500,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey, height, setCenter, top, x]);
  return null;
}

type MeshViewport = { x: number; y: number; zoom: number };
type SavedMeshLayout = {
  positions: Record<string, MeshPin>;
  viewport: MeshViewport | null;
};

const EMPTY_MESH_PINS: Record<string, MeshPin> = {};

function RestoreViewport({
  token,
  viewport,
}: {
  token: string;
  viewport: MeshViewport;
}) {
  const { setViewport } = useReactFlow();
  const applied = useRef("");
  useLayoutEffect(() => {
    if (applied.current === token) return;
    applied.current = token;
    const frame = requestAnimationFrame(() => {
      void setViewport(viewport, { duration: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [setViewport, token, viewport]);
  return null;
}

export function MeshPanel({
  projectId,
  suggestions = EMPTY_SUGGESTIONS,
}: {
  projectId: number;
  suggestions?: readonly MeshSuggestion[];
}) {
  const queryClient = useQueryClient();
  const rootKey = `project:${projectId}`;
  const [stack, setStack] = useState<string[]>([rootKey]);
  const focusKey = stack[stack.length - 1] ?? rootKey;
  const [colorMode, setColorMode] = useState<MeshColorMode>(readColorMode);
  const [depth, setDepth] = useState<MeshDepth>(readDepth);
  const [hideDone, setHideDone] = useState(readHideDone);
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<string>>(readHiddenTypes);
  const [relations, setRelations] = useState<MeshRelations>(readRelations);
  const [droppedFor, setDroppedFor] = useState<{ focus: string; ids: ReadonlySet<string> }>({
    focus: rootKey,
    ids: EMPTY_IDS,
  });
  const [view, setView] = useState<"focus" | "plan">("focus");
  const [openGroups, setOpenGroups] = useState<{ focus: string; keys: ReadonlySet<string> }>({
    focus: rootKey,
    keys: EMPTY_IDS,
  });
  const [resetOpen, setResetOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{
    focus: string;
    view: "focus" | "plan";
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [today] = useState(() => new Date());
  const [motion, setMotion] = useState<{
    seen: ReadonlySet<string>;
    origin: { x: number; y: number } | null;
  }>({ seen: new Set(), origin: null });

  const graphQuery = useQuery({
    queryKey: ["graph", focusKey, depth],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await apiJson<{ data: GraphPayload }>(
        `/api/v1/graph?root=${encodeURIComponent(focusKey)}&depth=${depth}`,
      );
      return res.data;
    },
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await apiJson<{ data: Project[] }>("/api/v1/projects");
      return res.data;
    },
  });

  const projectRefs = useMemo(() => {
    const refs = new Map<number, string>();
    for (const project of projectsQuery.data ?? []) {
      refs.set(project.id, formatEntityRef("project", project.number));
    }
    return refs;
  }, [projectsQuery.data]);
  const meshProjectName =
    projectsQuery.data?.find((project) => project.id === projectId)?.name ?? "this project";

  const reduceMotion = prefersReducedMotion();
  const [cardKey, setCardKey] = useState<string | null>(null);
  const cardKeyRef = useRef<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const skipOpen = useRef(false);
  const dragStart = useRef<{ id: string; x: number; y: number } | null>(null);
  const viewportTimer = useRef<number | null>(null);
  const hotKeyRef = useRef<string | null>(null);
  const rememberHot = useCallback((key: string | null) => {
    hotKeyRef.current = key;
  }, []);
  const releaseHotToPointer = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const hovered = canvas.querySelector(".mesh-node:hover");
    const hoveredKey = hovered?.getAttribute("data-mesh-key") ?? null;
    const active = document.activeElement;
    const focused =
      active instanceof HTMLElement && canvas.contains(active)
        ? (active.closest(".mesh-node")?.getAttribute("data-mesh-key") ?? null)
        : null;
    const keep = hoveredKey ?? focused;
    hotKeyRef.current = keep;
    paintMeshHot(canvas, keep);
  }, []);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const touchArmed = useRef<string | null>(null);
  const clearShow = useCallback(() => {
    if (showTimer.current != null) window.clearTimeout(showTimer.current);
    showTimer.current = null;
  }, []);
  const clearHide = useCallback(() => {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);
  const dismissCard = useCallback(() => {
    clearShow();
    clearHide();
    cardKeyRef.current = null;
    setCardKey(null);
  }, [clearHide, clearShow]);
  const showCardNow = useCallback(
    (key: string) => {
      clearShow();
      clearHide();
      cardKeyRef.current = key;
      setCardKey(key);
    },
    [clearHide, clearShow],
  );
  const scheduleShow = useCallback(
    (key: string) => {
      clearHide();
      clearShow();
      showTimer.current = window.setTimeout(() => {
        cardKeyRef.current = key;
        setCardKey(key);
      }, 200);
    },
    [clearHide, clearShow],
  );
  const scheduleHide = useCallback(() => {
    clearShow();
    clearHide();
    hideTimer.current = window.setTimeout(() => {
      cardKeyRef.current = null;
      setCardKey(null);
    }, 180);
  }, [clearHide, clearShow]);
  const armTouch = useCallback((key: string) => {
    touchArmed.current = cardKeyRef.current === key ? null : key;
  }, []);
  const consumeTouch = useCallback(
    (key: string) => {
      if (touchArmed.current !== key) return false;
      touchArmed.current = null;
      showCardNow(key);
      return true;
    },
    [showCardNow],
  );
  const placeCard = useCallback(() => {
    const key = cardKeyRef.current;
    const canvas = canvasRef.current;
    const card = cardRef.current;
    if (!key || !canvas || !card) return;
    const placed = placeMeshCard(canvas, card, key);
    card.style.visibility = placed ? "visible" : "hidden";
  }, []);
  const droppedIds = droppedFor.focus === focusKey ? droppedFor.ids : EMPTY_IDS;
  const liveSuggestions = useMemo(
    () => suggestions.filter((item) => !droppedIds.has(suggestionIdentity(item))),
    [droppedIds, suggestions],
  );
  const shownSuggestions = relations.suggestions ? liveSuggestions : EMPTY_SUGGESTIONS;
  const filteredGraph = useMemo(() => {
    if (!graphQuery.data) return null;
    return filterMeshGraph({
      nodes: graphQuery.data.nodes,
      edges: graphQuery.data.edges,
      focusKey,
      hideDone,
      hiddenTypes,
    });
  }, [focusKey, graphQuery.data, hiddenTypes, hideDone]);
  const layoutQuery = useQuery({
    queryKey: ["mesh-layout", focusKey, view] as const,
    queryFn: async () => {
      const res = await apiJson<{ data: SavedMeshLayout | null }>(
        `/api/v1/mesh-layouts?root=${encodeURIComponent(focusKey)}&view=${view}`,
      );
      return res.data;
    },
  });
  const savedPins = layoutQuery.data?.positions ?? EMPTY_MESH_PINS;
  const layout = useMemo(() => {
    if (!filteredGraph) return null;
    const shared = {
      nodes: filteredGraph.nodes,
      edges: filteredGraph.edges,
      focusKey,
      meshProjectId: projectId,
      projectRefs,
      references: relations.references,
      dependsOn: relations.dependsOn,
      suggestions: shownSuggestions,
    };
    const base =
      view === "plan"
        ? layoutMeshPlan({
            ...shared,
            blockNodes: graphQuery.data?.nodes ?? filteredGraph.nodes,
            blockEdges: graphQuery.data?.edges ?? filteredGraph.edges,
          })
        : layoutMesh({
            ...shared,
            expandedGroups: openGroups.focus === focusKey ? openGroups.keys : EMPTY_IDS,
          });
    return applyMeshPins(base, savedPins);
  }, [
    filteredGraph,
    focusKey,
    graphQuery.data,
    projectId,
    projectRefs,
    relations.dependsOn,
    relations.references,
    openGroups,
    savedPins,
    shownSuggestions,
    view,
  ]);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (cardKey) canvas.dataset.meshCard = cardKey;
    else delete canvas.dataset.meshCard;
    paintMeshHot(canvas, hotKeyRef.current);
    canvas.querySelectorAll(".mesh-node").forEach((button) => {
      if (button instanceof HTMLButtonElement) applyMeshNodeTitle(button, cardKey);
    });
  }, [layout, cardKey]);
  useLayoutEffect(() => {
    placeCard();
    const viewport = canvasRef.current?.querySelector(".react-flow__viewport");
    if (!(viewport instanceof HTMLElement) || !cardKey) return;
    const observer = new MutationObserver(() => placeCard());
    observer.observe(viewport, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, [cardKey, layout, placeCard]);
  useLayoutEffect(() => {
    return () => {
      clearShow();
      clearHide();
    };
  }, [clearHide, clearShow]);

  const focusRecord = graphQuery.data?.nodes.find((node) => node.key === focusKey);
  const outsideProject =
    focusRecord != null && focusRecord.projectId != null && focusRecord.projectId !== projectId;

  const focusNode = layout?.nodes.find((node) => node.role === "focus");
  const frameTop = useMemo(() => {
    if (!layout) return 0;
    const ys = [...layout.nodes.map((node) => node.y), ...layout.headings.map((heading) => heading.y)];
    return ys.length > 0 ? Math.min(...ys) : 0;
  }, [layout]);
  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const res = await apiJson<{ data: { meshAppearance?: unknown } }>("/api/v1/config");
      return normalizeMeshAppearance(res.data.meshAppearance);
    },
    staleTime: 15_000,
  });
  const appearance = configQuery.data ?? MESH_APPEARANCE_DEFAULTS;
  const chrome = meshChrome(appearance);
  const graphByKey = useMemo(() => {
    const map = new Map<string, MeshGraphNode>();
    for (const node of graphQuery.data?.nodes ?? []) map.set(node.key, node);
    return map;
  }, [graphQuery.data]);
  const hiddenOver = useMemo(() => {
    if (!graphQuery.data || !layout) return new Map<string, number>();
    return hiddenOverdueCounts(
      filteredGraph?.nodes ?? graphQuery.data.nodes,
      filteredGraph?.edges ?? graphQuery.data.edges,
      new Set(layout.nodes.map((node) => node.key)),
      today,
    );
  }, [filteredGraph, graphQuery.data, layout, today]);

  const chooseDepth = useCallback((next: MeshDepth) => {
    setDepth(next);
    try {
      localStorage.setItem("mesh-depth", String(next));
    } catch {
      /* private browsing */
    }
  }, []);

  const toggleHideDone = useCallback(() => {
    setHideDone((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("mesh-hide-done", next ? "1" : "0");
      } catch {
        /* private browsing */
      }
      return next;
    });
  }, []);

  const toggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      try {
        localStorage.setItem("mesh-hidden-types", JSON.stringify([...next]));
      } catch {
        /* private browsing */
      }
      return next;
    });
  }, []);

  const typeChips = useMemo(() => {
    const present = new Set(graphQuery.data?.nodes.map((node) => node.type) ?? []);
    return LEGEND_SHAPES.filter((shape) => present.has(shape.type));
  }, [graphQuery.data]);

  const chooseColor = useCallback((mode: MeshColorMode) => {
    setColorMode(mode);
    try {
      localStorage.setItem("mesh-color", mode);
    } catch {
      /* private browsing */
    }
  }, []);

  const toggleRelation = useCallback((key: keyof MeshRelations) => {
    setRelations((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem("mesh-relations", JSON.stringify(next));
      } catch {
        /* private browsing */
      }
      return next;
    });
  }, []);

  const hideSuggestions = useCallback(
    (match: (item: MeshSuggestion) => boolean) => {
      setDroppedFor((prev) => {
        const ids = new Set(prev.focus === focusKey ? prev.ids : EMPTY_IDS);
        for (const item of suggestions) {
          if (match(item)) ids.add(suggestionIdentity(item));
        }
        return { focus: focusKey, ids };
      });
    },
    [focusKey, suggestions],
  );

  const acceptLink = useMutation({
    mutationFn: async (item: MeshSuggestion) => {
      const src = parseEntityKey(item.sourceKey);
      const dst = parseEntityKey(item.targetKey);
      if (!src || !dst) throw new Error("That suggestion does not name two records.");
      await apiJson("/api/v1/links", {
        method: "POST",
        body: JSON.stringify({
          srcType: src.entityType,
          srcId: src.id,
          dstType: dst.entityType,
          dstId: dst.id,
          relation: "references",
        }),
      });
      return item;
    },
    onSuccess: (item) => {
      hideSuggestions(
        (row) => row.sourceKey === item.sourceKey && row.targetKey === item.targetKey,
      );
      void queryClient.invalidateQueries({ queryKey: ["graph"] });
    },
  });

  const rememberMotion = useCallback(() => {
    const focus = layout?.nodes.find((node) => node.role === "focus");
    setMotion({
      seen: new Set(layout?.nodes.map((node) => node.key) ?? []),
      origin: focus ? { x: focus.x, y: focus.y } : null,
    });
  }, [layout]);

  const toggleGroup = useCallback(
    (key: string) => {
      dismissCard();
      setOpenGroups((prev) => {
        const keys = new Set(prev.focus === focusKey ? prev.keys : []);
        if (keys.has(key)) keys.delete(key);
        else keys.add(key);
        return { focus: focusKey, keys };
      });
    },
    [dismissCard, focusKey],
  );

  const openNode = useCallback(
    (key: string) => {
      if (skipOpen.current) {
        skipOpen.current = false;
        return;
      }
      dismissCard();
      if (key === focusKey) return;
      rememberMotion();
      setStack((prev) => {
        const existing = prev.lastIndexOf(key);
        if (existing >= 0) return prev.slice(0, existing + 1);
        return [...prev, key];
      });
    },
    [dismissCard, focusKey, rememberMotion],
  );

  const goBack = useCallback(() => {
    if (stack.length < 2) return;
    dismissCard();
    rememberMotion();
    setStack((prev) => prev.slice(0, -1));
  }, [dismissCard, rememberMotion, stack.length]);

  const saveLayout = useMutation({
    mutationFn: async (input: { root: string; view: "focus" | "plan"; body: SavedMeshLayout }) => {
      const res = await apiJson<{ data: SavedMeshLayout }>(
        `/api/v1/mesh-layouts?root=${encodeURIComponent(input.root)}&view=${input.view}`,
        { method: "PUT", body: JSON.stringify(input.body) },
      );
      return { key: ["mesh-layout", input.root, input.view] as const, data: res.data };
    },
    onSuccess: (result) => {
      queryClient.setQueryData(result.key, result.data);
      setSaveError(null);
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const resetSavedLayout = useMutation({
    mutationFn: async (input: { root: string; view: "focus" | "plan" }) => {
      await apiJson(
        `/api/v1/mesh-layouts?root=${encodeURIComponent(input.root)}&view=${input.view}`,
        { method: "DELETE" },
      );
      return ["mesh-layout", input.root, input.view] as const;
    },
    onSuccess: (key) => {
      queryClient.setQueryData(key, null);
      setSaveError(null);
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const commitPin = useCallback(
    (id: string, x: number, y: number) => {
      const graphKeys = new Set(graphQuery.data?.nodes.map((node) => node.key) ?? []);
      if (!graphKeys.has(id) || !layoutQuery.isSuccess) return;
      const positions = meshPinsInGraph(
        { ...(layoutQuery.data?.positions ?? EMPTY_MESH_PINS), [id]: { x, y } },
        graphKeys,
      );
      const body: SavedMeshLayout = {
        positions,
        viewport: layoutQuery.data?.viewport ?? null,
      };
      const key = ["mesh-layout", focusKey, view] as const;
      queryClient.setQueryData(key, body);
      saveLayout.mutate({ root: focusKey, view, body });
    },
    [focusKey, graphQuery.data?.nodes, layoutQuery.data, layoutQuery.isSuccess, queryClient, saveLayout, view],
  );

  const scheduleViewport = useCallback(
    (viewport: MeshViewport) => {
      const root = focusKey;
      const mode = view;
      const keys = new Set(graphQuery.data?.nodes.map((node) => node.key) ?? []);
      if (viewportTimer.current != null) window.clearTimeout(viewportTimer.current);
      viewportTimer.current = window.setTimeout(() => {
        const queryKey = ["mesh-layout", root, mode] as const;
        if (queryClient.getQueryState(queryKey)?.status !== "success") return;
        const saved = queryClient.getQueryData<SavedMeshLayout | null>(queryKey);
        const body: SavedMeshLayout = {
          positions: meshPinsInGraph(saved?.positions ?? EMPTY_MESH_PINS, keys),
          viewport,
        };
        queryClient.setQueryData(queryKey, body);
        saveLayout.mutate({ root, view: mode, body });
      }, 400);
    },
    [focusKey, graphQuery.data?.nodes, queryClient, saveLayout, view],
  );

  useLayoutEffect(
    () => () => {
      if (viewportTimer.current != null) window.clearTimeout(viewportTimer.current);
    },
    [],
  );

  const cards = useMemo(() => {
    const map = new Map<string, MeshCardModel>();
    if (!layout || !graphQuery.data) return map;
    for (const node of layout.nodes) {
      const record = graphByKey.get(node.key);
      if (!record) continue;
      map.set(
        node.key,
        buildMeshCard({
          node: { ...record, projectLabel: node.projectLabel },
          nodes: graphQuery.data.nodes,
          edges: graphQuery.data.edges,
          today,
          staleDays: chrome.staleDays,
          isFocus: node.role === "focus",
          suggestions: shownSuggestions,
        }),
      );
    }
    return map;
  }, [chrome.staleDays, graphByKey, graphQuery.data, layout, shownSuggestions, today]);

  const suggestionCards = useMemo(() => {
    const map = new Map<string, MeshSuggestionCardModel>();
    if (!layout || !graphQuery.data) return map;
    for (const node of layout.nodes) {
      if (node.role !== "suggestion") continue;
      const record = graphByKey.get(node.key);
      if (!record) continue;
      const model = buildMeshSuggestionCard({
        node: { ...record, projectLabel: node.projectLabel },
        nodes: graphQuery.data.nodes,
        suggestions: shownSuggestions,
      });
      if (model) map.set(node.key, model);
    }
    return map;
  }, [graphByKey, graphQuery.data, layout, shownSuggestions]);

  const flowNodes: MeshFlowNode[] = useMemo(
    () =>
      layout
    ? layout.nodes.map((node) => {
        const record = node.group ? undefined : graphByKey.get(node.key);
        const ink = glyphStyle(node.group ? "type" : colorMode, {
          key: node.key,
          type: node.type,
          ...record,
        });
        const mark = record ? schedule(record, today) : { kind: "none" as const };
        return {
          id: node.key,
          type: "mesh" as const,
          position:
            dragPos?.focus === focusKey && dragPos.view === view && dragPos.id === node.key
              ? { x: dragPos.x, y: dragPos.y }
              : { x: node.x, y: node.y },
          data: {
            title: node.title,
            referenceId: node.referenceId,
            projectLabel: node.projectLabel,
            type: node.type,
            role: node.role,
            planMark: node.planMark,
            color: ink.color,
            hollow: ink.hollow,
            progress: record?.progress ?? null,
            priority: record?.priority ?? null,
            schedule: mark.kind,
            stale: record ? isStale(record, today, chrome.staleDays) : false,
            hiddenOver: hiddenOver.get(node.key) ?? 0,
            pulse: chrome.pulse && !reduceMotion,
            x: node.x,
            y: node.y,
            enterFrom: !motion.seen.has(node.key) && motion.origin && !reduceMotion ? motion.origin : null,
            reduceMotion,
            cardText: node.group
              ? node.title
              : ((node.role === "suggestion"
                  ? suggestionCards.get(node.key)?.description
                  : cards.get(node.key)?.description) ?? node.title),
            group: node.group,
            onOpen: openNode,
            onToggleGroup: toggleGroup,
            onPointerEnter: scheduleShow,
            onPointerLeave: scheduleHide,
            onFocusNode: showCardNow,
            onBlurNode: scheduleHide,
            onHot: rememberHot,
            armTouch,
            consumeTouch,
          },
          draggable: layoutQuery.isSuccess && node.group == null,
          connectable: false,
        };
      })
        : [],
    [
      armTouch,
      cards,
      chrome.pulse,
      chrome.staleDays,
      colorMode,
      consumeTouch,
      dragPos,
      focusKey,
      graphByKey,
      hiddenOver,
      layout,
      layoutQuery.isSuccess,
      motion,
      toggleGroup,
      openNode,
      reduceMotion,
      rememberHot,
      scheduleHide,
      scheduleShow,
      showCardNow,
      suggestionCards,
      today,
      view,
    ],
  );
  const flowEdges = useMemo(
    () =>
      layout
    ? layout.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: "mesh" as const,
        data: {
          sourceOffset: edge.sourceOffset,
          targetOffset: edge.targetOffset,
          laneX: edge.laneX,
          corridor: edge.corridor,
          trunkCount: edge.trunkCount,
          trunkPath: edge.trunkPath,
        },
        className: [
          "mesh-edge",
          edge.kind === "suggested"
            ? "mesh-edge--suggested"
            : edge.kind === "depends"
              ? edge.blocking
                ? "mesh-edge--blocking"
                : "mesh-edge--dep"
              : "mesh-edge--ref",
          edge.bundled ? "mesh-edge--bundled" : "",
          edge.trunkCount ? "mesh-edge--trunk" : "",
        ]
          .filter(Boolean)
          .join(" "),
        markerEnd:
          edge.kind === "depends"
            ? {
                type: MarkerType.ArrowClosed,
                width: 16,
                height: 16,
                color: edge.blocking ? "var(--mesh-signal-overdue)" : "var(--mesh-rel-dep)",
              }
            : undefined,
      }))
        : [],
    [layout],
  );

  const suggestionCard = cardKey ? (suggestionCards.get(cardKey) ?? null) : null;
  const hoverCard = suggestionCard || !cardKey ? null : (cards.get(cardKey) ?? null);

  return (
    <section
      className={appearance.labelHalo ? "mesh-panel" : "mesh-panel mesh-panel--no-halo"}
      style={meshAppearanceStyle(appearance)}
      aria-label="Mesh"
    >
      <div className="mesh-toolbar">
        <button
          type="button"
          className="btn small ghost"
          disabled={stack.length < 2}
          onClick={goBack}
        >
          Back
        </button>
        <nav className="mesh-crumbs" aria-label="Ancestors">
          {(layout?.ancestors ?? []).map((ancestor, index, all) => {
            const last = index === all.length - 1;
            return (
              <span key={ancestor.key} className="mesh-crumbs__item">
                {index > 0 ? (
                  <span className="mesh-crumbs__sep" aria-hidden>
                    ›
                  </span>
                ) : null}
                <button
                  type="button"
                  className="mesh-crumb"
                  disabled={last}
                  aria-current={last ? "true" : undefined}
                  onClick={() => openNode(ancestor.key)}
                >
                  {ancestor.title}
                </button>
              </span>
            );
          })}
          {outsideProject ? (
            <>
              <span className="mesh-crumbs__sep" aria-hidden>
                ·
              </span>
              <button type="button" className="mesh-crumb" onClick={() => openNode(rootKey)}>
                Back to {meshProjectName}
              </button>
            </>
          ) : null}
        </nav>
        <div className="mesh-view" role="group" aria-label="Mesh view">
          <span>View</span>
          <button
            type="button"
            aria-pressed={view === "focus"}
            onClick={() => {
              if (view === "focus") return;
              rememberMotion();
              setView("focus");
            }}
          >
            Focus
          </button>
          <button
            type="button"
            aria-pressed={view === "plan"}
            onClick={() => {
              if (view === "plan") return;
              rememberMotion();
              setView("plan");
            }}
          >
            Plan
          </button>
        </div>
        <div className="mesh-filters" role="group" aria-label="Relationships">
          <button
            type="button"
            className="mesh-filter"
            aria-pressed={relations.references}
            onClick={() => toggleRelation("references")}
          >
            <span className="mesh-swatch mesh-swatch--ref" aria-hidden="true" />
            References
          </button>
          <button
            type="button"
            className="mesh-filter"
            aria-pressed={relations.dependsOn}
            onClick={() => toggleRelation("dependsOn")}
          >
            <span className="mesh-swatch mesh-swatch--dep" aria-hidden="true" />
            Depends on
          </button>
          {suggestions.length > 0 ? (
            <button
              type="button"
              className="mesh-filter mesh-filter--ai"
              aria-pressed={relations.suggestions}
              onClick={() => toggleRelation("suggestions")}
            >
              <span className="mesh-swatch mesh-swatch--ai" aria-hidden="true" />
              AI suggestions
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="mesh-filter"
          aria-pressed={hideDone}
          onClick={toggleHideDone}
        >
          Hide done
        </button>
        {typeChips.length > 0 ? (
          <div className="mesh-filters" role="group" aria-label="Record types">
            {typeChips.map((shape) => (
              <button
                key={shape.type}
                type="button"
                className="mesh-filter"
                aria-pressed={!hiddenTypes.has(shape.type)}
                onClick={() => toggleType(shape.type)}
              >
                {shape.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mesh-depth" role="group" aria-label="Depth">
          <span>Depth</span>
          {([1, 2, 3] as const).map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={depth === level}
              onClick={() => chooseDepth(level)}
            >
              {level}
            </button>
          ))}
        </div>
        <div className="mesh-colors" role="group" aria-label="Color nodes by">
          <span>Color</span>
          {COLOR_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              aria-pressed={colorMode === mode.id}
              onClick={() => chooseColor(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        {graphQuery.data?.truncated ? (
          <p className="mesh-note">Some nearby records are not shown.</p>
        ) : null}
        <button
          type="button"
          className="btn small ghost mesh-reset"
          disabled={
            !layoutQuery.data ||
            (Object.keys(layoutQuery.data.positions).length === 0 && layoutQuery.data.viewport == null)
          }
          onClick={() => setResetOpen(true)}
        >
          Reset layout
        </button>
        {saveError ? (
          <p className="mesh-note" role="alert">
            {saveError}
          </p>
        ) : null}
      </div>
      {graphQuery.isLoading ? <p className="mesh-status">Loading mesh…</p> : null}
      {graphQuery.isError ? (
        <p className="mesh-status" role="alert">
          {(graphQuery.error as Error).message}
        </p>
      ) : null}
      {layout && layout.nodes.length > 0 ? (
        <div className="mesh-canvas" ref={canvasRef}>
          <svg className="mesh-hot-marker" aria-hidden="true">
            <defs>
              <marker
                id="mesh-hot-arrow"
                markerWidth="16"
                markerHeight="16"
                viewBox="-10 -10 20 20"
                markerUnits="strokeWidth"
                orient="auto-start-reverse"
                refX="0"
                refY="0"
              >
                <polyline
                  points="-5,-4 0,0 -5,4 -5,-4"
                  fill="context-stroke"
                  stroke="context-stroke"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </marker>
            </defs>
          </svg>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={layoutQuery.isSuccess}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnScroll
            zoomOnScroll={false}
            nodeDragThreshold={4}
            minZoom={1}
            maxZoom={1.75}
            onMove={placeCard}
            onMoveEnd={(event, viewport) => {
              placeCard();
              if (!event) return;
              scheduleViewport(viewport);
            }}
            onNodeDragStart={(_event, node) => {
              dragStart.current = { id: node.id, x: node.position.x, y: node.position.y };
              skipOpen.current = false;
            }}
            onNodeDrag={(_event, node) => {
              const start = dragStart.current;
              if (!start || start.id !== node.id) return;
              if (Math.hypot(node.position.x - start.x, node.position.y - start.y) > 4) {
                skipOpen.current = true;
              }
              setDragPos({ focus: focusKey, view, id: node.id, x: node.position.x, y: node.position.y });
            }}
            onNodeDragStop={(_event, node) => {
              const start = dragStart.current;
              dragStart.current = null;
              setDragPos(null);
              if (!start || start.id !== node.id) return;
              if (Math.hypot(node.position.x - start.x, node.position.y - start.y) <= 4) {
                skipOpen.current = false;
                return;
              }
              commitPin(node.id, node.position.x, node.position.y);
            }}
            defaultViewport={{ x: 48, y: 0, zoom: 1 }}
            proOptions={{ hideAttribution: false }}
            colorMode="dark"
          >
            {layoutQuery.isSuccess && layoutQuery.data?.viewport ? (
              <RestoreViewport token={`${focusKey}:${view}`} viewport={layoutQuery.data.viewport} />
            ) : layoutQuery.isSuccess ? (
              <FrameFocus
                focusKey={focusKey}
                x={focusNode?.centerX ?? 0}
                top={frameTop}
              />
            ) : null}
            <ViewportPortal>
              <svg className="mesh-tree" width="12000" height="12000">
                {layout.tree.map((d, index) => (
                  <path key={`${index}:${d}`} d={d} className="mesh-tree__path" />
                ))}
              </svg>
              {layout.headings.map((heading) => (
                <div
                  key={`${heading.text}:${heading.y}`}
                  className={heading.tone === "ai" ? "mesh-rail-head mesh-rail-head--ai" : "mesh-rail-head"}
                  style={{ transform: `translate(${heading.x}px, ${heading.y}px)` }}
                >
                  {heading.text}
                </div>
              ))}
            </ViewportPortal>
          </ReactFlow>
          {hoverCard ? (
            <MeshHoverCard
              cardRef={cardRef}
              model={hoverCard}
              onPointerEnter={() => {
                clearShow();
                clearHide();
              }}
              onPointerLeave={() => {
                scheduleHide();
                releaseHotToPointer();
              }}
            />
          ) : null}
          {suggestionCard && cardKey ? (
            <MeshSuggestionCard
              cardRef={cardRef}
              model={suggestionCard}
              pending={acceptLink.isPending}
              error={acceptLink.isError ? (acceptLink.error as Error).message : null}
              onAccept={(targetKey) => {
                const item = liveSuggestions.find(
                  (row) => row.sourceKey === cardKey && row.targetKey === targetKey,
                );
                if (item) acceptLink.mutate(item);
              }}
              onDismiss={(item) => {
                hideSuggestions(
                  (row) =>
                    row.sourceKey === cardKey &&
                    row.targetKey === item.targetKey &&
                    row.confidence === item.confidence &&
                    row.reason === item.reason,
                );
              }}
              onPointerEnter={() => {
                clearShow();
                clearHide();
              }}
              onPointerLeave={() => {
                scheduleHide();
                releaseHotToPointer();
              }}
            />
          ) : null}
        </div>
      ) : null}
      <section className="mesh-legend">
        <button
          type="button"
          className="mesh-legend__toggle"
          aria-expanded={legendOpen}
          onClick={() => setLegendOpen((open) => !open)}
        >
          Legend
        </button>
        {legendOpen ? (
          <div className="mesh-legend__grid">
            <div>
              <h2>Shape = record type</h2>
              <ul>
                {LEGEND_SHAPES.map((item) => (
                  <li key={item.type}>
                    <MeshShape type={item.type} color={`var(--mesh-type-${item.type})`} hollow={false} />
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2>{colorMode === "type" ? "Color = type" : colorMode === "state" ? "Color = state" : "Color = priority"}</h2>
              <ul>
                {legendColors(colorMode).map((item) => (
                  <li key={item.label}>
                    <MeshShape type="task" color={item.color} hollow={item.hollow ?? false} />
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2>Lines = relationship</h2>
              <ul>
                <li><span className="mesh-swatch mesh-swatch--tree" /> Contains</li>
                <li><span className="mesh-swatch mesh-swatch--ref" /> References</li>
                <li><span className="mesh-swatch mesh-swatch--dep" /> Depends on (done)</li>
                <li><span className="mesh-swatch mesh-swatch--block" /> Depends on (still blocking)</li>
                <li><span className="mesh-swatch mesh-swatch--ai" /> Suggested by AI</li>
              </ul>
            </div>
            <div>
              <h2>Signals</h2>
              <ul>
                <li><span className="mesh-swatch mesh-swatch--ring" /> Progress ring</li>
                <li><span className="mesh-swatch mesh-swatch--over" /> Overdue</li>
                <li><span className="mesh-swatch mesh-swatch--risk" /> At risk</li>
                <li><span className="mesh-badge mesh-badge--urgent">!!</span> High or urgent</li>
                <li>Clock mark: no state change in 30+ days</li>
                {view === "plan" ? (
                  <>
                    <li>
                      <span className="mesh-swatch mesh-swatch--over" /> Blocked
                    </li>
                    <li>
                      <span className="mesh-swatch mesh-swatch--next" /> Next
                    </li>
                  </>
                ) : null}
                <li>A red count is overdue work sitting further down, out of view.</li>
              </ul>
            </div>
          </div>
        ) : null}
      </section>
      <ConfirmDialog
        open={resetOpen}
        title="Reset layout"
        message="Clear pinned positions and the saved pan and zoom for this record in this view?"
        confirmLabel="Reset"
        confirmTone="danger"
        onConfirm={() => {
          setResetOpen(false);
          resetSavedLayout.mutate({ root: focusKey, view });
        }}
        onCancel={() => setResetOpen(false)}
      />
    </section>
  );
}
