import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Handle,
  Position,
  ReactFlow,
  ViewportPortal,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import { apiJson } from "../api/client";
import { formatEntityRef } from "../lib/entityRef";
import {
  layoutMesh,
  type MeshGraphEdge,
  type MeshGraphNode,
  type MeshLayoutNode,
} from "../lib/meshLayout";
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
  role: MeshLayoutNode["role"];
  x: number;
  y: number;
  enterFrom: { x: number; y: number } | null;
  reduceMotion: boolean;
  onOpen: (key: string) => void;
};

type MeshFlowNode = Node<MeshNodeData, "mesh">;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
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

  const label = [data.referenceId, data.title, data.projectLabel].filter(Boolean).join(", ");
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
        aria-label={label}
        title={data.title}
        onClick={() => data.onOpen(id)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          data.onOpen(id);
        }}
      >
        <span className="mesh-glyph" aria-hidden />
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

  const focusRecord = graphQuery.data?.nodes.find((node) => node.key === focusKey);
  const outsideProject =
    focusRecord != null && focusRecord.projectId != null && focusRecord.projectId !== projectId;

  const focusNode = layout?.nodes.find((node) => node.role === "focus");

  const rememberMotion = useCallback(() => {
    const focus = layout?.nodes.find((node) => node.role === "focus");
    setMotion({
      seen: new Set(layout?.nodes.map((node) => node.key) ?? []),
      origin: focus ? { x: focus.x, y: focus.y } : null,
    });
  }, [layout]);

  const openNode = useCallback(
    (key: string) => {
      if (key === focusKey) return;
      rememberMotion();
      setStack((prev) => {
        const existing = prev.lastIndexOf(key);
        if (existing >= 0) return prev.slice(0, existing + 1);
        return [...prev, key];
      });
    },
    [focusKey, rememberMotion],
  );

  const goBack = useCallback(() => {
    if (stack.length < 2) return;
    rememberMotion();
    setStack((prev) => prev.slice(0, -1));
  }, [rememberMotion, stack.length]);

  const flowNodes: MeshFlowNode[] = layout
    ? layout.nodes.map((node) => ({
        id: node.key,
        type: "mesh",
        position: { x: node.x, y: node.y },
        data: {
          title: node.title,
          referenceId: node.referenceId,
          projectLabel: node.projectLabel,
          role: node.role,
          x: node.x,
          y: node.y,
          enterFrom: !motion.seen.has(node.key) && motion.origin && !reduceMotion ? motion.origin : null,
          reduceMotion,
          onOpen: openNode,
        },
        draggable: false,
        connectable: false,
      }))
    : [];
  const flowEdges = layout
    ? layout.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: "smoothstep" as const,
      }))
    : [];

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
        <div className="mesh-canvas">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnScroll
            zoomOnScroll={false}
            minZoom={1}
            maxZoom={1.75}
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
        </div>
      ) : null}
    </section>
  );
}
