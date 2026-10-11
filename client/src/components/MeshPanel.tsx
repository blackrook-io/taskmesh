import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  BaseEdge,
  getSmoothStepPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ViewportPortal,
  useReactFlow,
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
import { MeshShape } from "./MeshShape";
import { buildMeshCard, type MeshCardModel } from "../lib/meshCard";
import { formatEntityRef } from "../lib/entityRef";
import {
  layoutMesh,
  type MeshGraphEdge,
  type MeshGraphNode,
  type MeshLayoutNode,
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
  onOpen: (key: string) => void;
  onPointerEnter: (key: string) => void;
  onPointerLeave: () => void;
  onFocusNode: (key: string) => void;
  onBlurNode: () => void;
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

function meshChrome(): { staleDays: number; pulse: boolean } {
  if (typeof document === "undefined") return { staleDays: 30, pulse: true };
  const panel = document.querySelector(".mesh-panel");
  if (!(panel instanceof HTMLElement)) return { staleDays: 30, pulse: true };
  const style = getComputedStyle(panel);
  const days = Number(style.getPropertyValue("--mesh-stale-days"));
  return {
    staleDays: Number.isFinite(days) && days > 0 ? days : 30,
    pulse: style.getPropertyValue("--mesh-pulse").trim() !== "0",
  };
}

type MeshFlowNode = Node<MeshNodeData, "mesh">;

const MESH_HOT_MARKER = "url('#mesh-hot-arrow')";

function paintMeshHot(from: Element, key: string | null) {
  const canvas = from.closest(".mesh-canvas");
  if (!canvas) return;
  canvas.querySelectorAll(".react-flow__edge").forEach((edge) => {
    const mark = edge.querySelector("[data-source]");
    const source = mark?.getAttribute("data-source");
    const target = mark?.getAttribute("data-target");
    const hot = key != null && (source === key || target === key);
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
}

function MeshEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <g data-source={source} data-target={target} />
    </>
  );
}

function cardDescId(key: string): string {
  return `mesh-card-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function placeMeshCard(canvas: HTMLElement, card: HTMLElement, key: string): boolean {
  const node = canvas.querySelector(`[data-mesh-key="${CSS.escape(key)}"]`);
  if (!(node instanceof HTMLElement)) return false;
  const host = canvas.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  let left = box.right - host.left + 12;
  if (left + width > host.width - 8) left = box.left - host.left - width - 12;
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

function MeshRecordNode({ id, data }: NodeProps<MeshFlowNode>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const played = useRef(false);
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

  const label = [
    data.referenceId,
    data.title,
    data.projectLabel,
    data.schedule === "overdue" ? "overdue" : null,
    data.stale ? "stale" : null,
  ]
    .filter(Boolean)
    .join(", ");
  const ring = data.progress == null ? null : Math.max(0, Math.min(100, data.progress));
  return (
    <>
      <Handle id="t" type="target" position={Position.Top} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="r" type="source" position={Position.Right} />
      <button
        ref={buttonRef}
        type="button"
        className={`mesh-node mesh-node--${data.role}`}
        data-mesh-key={id}
        aria-label={label}
        aria-describedby={cardDescId(id)}
        title={data.title}
        onPointerDown={(event) => {
          if (event.pointerType === "touch") data.armTouch(id);
        }}
        onClick={(event) => {
          if (data.consumeTouch(id)) {
            event.preventDefault();
            return;
          }
          data.onOpen(id);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          data.onOpen(id);
        }}
        onMouseEnter={(event) => {
          paintMeshHot(event.currentTarget, id);
          data.onPointerEnter(id);
        }}
        onMouseLeave={(event) => {
          paintMeshHot(event.currentTarget, null);
          data.onPointerLeave();
        }}
        onFocus={(event) => {
          paintMeshHot(event.currentTarget, id);
          data.onFocusNode(id);
        }}
        onBlur={(event) => {
          paintMeshHot(event.currentTarget, null);
          data.onBlurNode();
        }}
      >
        <span id={cardDescId(id)} className="sr-only">
          {data.cardText}
        </span>
        <span className="mesh-mark">
          {data.schedule === "overdue" ? (
            <span className={data.pulse ? "mesh-ring mesh-ring--overdue mesh-ring--pulse" : "mesh-ring mesh-ring--overdue"} />
          ) : null}
          {data.schedule === "risk" ? <span className="mesh-ring mesh-ring--risk" /> : null}
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
          {data.priority === "urgent" || data.priority === "high" ? (
            <span className={`mesh-badge mesh-badge--${data.priority}`} aria-hidden>
              {data.priority === "urgent" ? "!!" : "!"}
            </span>
          ) : null}
          {data.stale ? (
            <svg className="mesh-stale" viewBox="0 0 12 12" aria-hidden>
              <circle cx="6" cy="6" r="5" />
              <path d="M6 3.4 V6.2 L8 7.3" />
            </svg>
          ) : null}
          {data.hiddenOver > 0 ? (
            <span className="mesh-count" aria-hidden>
              {data.hiddenOver}
            </span>
          ) : null}
        </span>
        <span className="mesh-copy">
          <span className="mesh-title">{data.title}</span>
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

function FrameFocus({
  focusKey,
  x,
  y,
}: {
  focusKey: string;
  x: number;
  y: number;
}) {
  const { setCenter } = useReactFlow();
  useLayoutEffect(() => {
    const reduce = prefersReducedMotion();
    const frame = requestAnimationFrame(() => {
      void setCenter(x + 80, y, { zoom: 1, duration: reduce ? 0 : 500 });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey, setCenter, x, y]);
  return null;
}

export function MeshPanel({ projectId }: { projectId: number }) {
  const rootKey = `project:${projectId}`;
  const [stack, setStack] = useState<string[]>([rootKey]);
  const focusKey = stack[stack.length - 1] ?? rootKey;
  const [colorMode, setColorMode] = useState<MeshColorMode>(readColorMode);
  const [legendOpen, setLegendOpen] = useState(false);
  const [today] = useState(() => new Date());
  const [motion, setMotion] = useState<{
    seen: ReadonlySet<string>;
    origin: { x: number; y: number } | null;
  }>({ seen: new Set(), origin: null });

  const graphQuery = useQuery({
    queryKey: ["graph", focusKey],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await apiJson<{ data: GraphPayload }>(
        `/api/v1/graph?root=${encodeURIComponent(focusKey)}&depth=3`,
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
  const layout = useMemo(() => {
    if (!graphQuery.data) return null;
    return layoutMesh({
      nodes: graphQuery.data.nodes,
      edges: graphQuery.data.edges,
      focusKey,
      meshProjectId: projectId,
      projectRefs,
    });
  }, [focusKey, graphQuery.data, projectId, projectRefs]);
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
  const chrome = meshChrome();
  const graphByKey = useMemo(() => {
    const map = new Map<string, MeshGraphNode>();
    for (const node of graphQuery.data?.nodes ?? []) map.set(node.key, node);
    return map;
  }, [graphQuery.data]);
  const hiddenOver = useMemo(() => {
    if (!graphQuery.data || !layout) return new Map<string, number>();
    return hiddenOverdueCounts(
      graphQuery.data.nodes,
      graphQuery.data.edges,
      new Set(layout.nodes.map((node) => node.key)),
      today,
    );
  }, [graphQuery.data, layout, today]);

  const chooseColor = useCallback((mode: MeshColorMode) => {
    setColorMode(mode);
    try {
      localStorage.setItem("mesh-color", mode);
    } catch {
      /* private browsing */
    }
  }, []);

  const rememberMotion = useCallback(() => {
    const focus = layout?.nodes.find((node) => node.role === "focus");
    setMotion({
      seen: new Set(layout?.nodes.map((node) => node.key) ?? []),
      origin: focus ? { x: focus.x, y: focus.y } : null,
    });
  }, [layout]);

  const openNode = useCallback(
    (key: string) => {
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
        }),
      );
    }
    return map;
  }, [chrome.staleDays, graphByKey, graphQuery.data, layout, today]);

  const flowNodes: MeshFlowNode[] = layout
    ? layout.nodes.map((node) => {
        const record = graphByKey.get(node.key);
        const ink = glyphStyle(colorMode, { key: node.key, type: node.type, ...record });
        const mark = record ? schedule(record, today) : { kind: "none" as const };
        return {
          id: node.key,
          type: "mesh" as const,
          position: { x: node.x, y: node.y },
          data: {
            title: node.title,
            referenceId: node.referenceId,
            projectLabel: node.projectLabel,
            type: node.type,
            role: node.role,
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
            cardText: cards.get(node.key)?.description ?? node.title,
            onOpen: openNode,
            onPointerEnter: scheduleShow,
            onPointerLeave: scheduleHide,
            onFocusNode: showCardNow,
            onBlurNode: scheduleHide,
            armTouch,
            consumeTouch,
          },
          draggable: false,
          connectable: false,
        };
      })
    : [];
  const flowEdges = layout
    ? layout.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: "mesh" as const,
        className: [
          "mesh-edge",
          edge.kind === "depends"
            ? edge.blocking
              ? "mesh-edge--blocking"
              : "mesh-edge--dep"
            : "mesh-edge--ref",
        ].join(" "),
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
    : [];

  const hoverCard = cardKey ? (cards.get(cardKey) ?? null) : null;

  return (
    <section className="mesh-panel" aria-label="Mesh">
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
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnScroll
            zoomOnScroll={false}
            minZoom={1}
            maxZoom={1.75}
            onMove={placeCard}
            onMoveEnd={placeCard}
            defaultViewport={{ x: 48, y: 120, zoom: 1 }}
            proOptions={{ hideAttribution: false }}
            colorMode="dark"
          >
            <FrameFocus
              focusKey={focusKey}
              x={focusNode?.centerX ?? 0}
              y={focusNode?.centerY ?? 0}
            />
            <ViewportPortal>
              <svg className="mesh-tree" width="12000" height="12000">
                {layout.tree.map((d, index) => (
                  <path key={`${index}:${d}`} d={d} className="mesh-tree__path" />
                ))}
              </svg>
              {layout.headings.map((heading) => (
                <div
                  key={`${heading.text}:${heading.y}`}
                  className="mesh-rail-head"
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
              onPointerLeave={scheduleHide}
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
                <li>A red count is overdue work sitting further down, out of view.</li>
              </ul>
            </div>
          </div>
        ) : null}
      </section>
    </section>
  );
}
