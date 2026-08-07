import {
  CaptureUpdateAction,
  exportToBlob,
  exportToSvg,
  getCommonBounds,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useState } from "react";
import {
  buildCanvasTemplateElements,
  CANVAS_TEMPLATES,
  type CanvasTemplateId,
} from "../lib/canvasTemplates";
import { downloadBlob, safeExportBasename } from "../lib/excalidrawScene";
import { ColorPopover } from "./shared/ColorPopover";

const PREFS_KEY = "taskmesh.canvas.layout";
const GRID_SIZE = 20;

export type CanvasLayoutPrefs = {
  grid: boolean;
};

const DEFAULT_PREFS: CanvasLayoutPrefs = { grid: true };

export function loadCanvasLayoutPrefs(): CanvasLayoutPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<CanvasLayoutPrefs> & { snap?: boolean };
    return {
      grid: parsed.grid ?? DEFAULT_PREFS.grid,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveCanvasLayoutPrefs(prefs: CanvasLayoutPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

type Props = {
  api: ExcalidrawImperativeAPI | null;
  prefs: CanvasLayoutPrefs;
  onPrefsChange: (prefs: CanvasLayoutPrefs) => void;
  disabled?: boolean;
  /** Bumps when selection changes so enable/disable updates. */
  selectionTick?: number;
  title?: string;
};

function AssistBtn({
  label,
  title,
  active,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`btn small canvas-assist__btn${active ? " is-active" : ""}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function selectedElements(api: ExcalidrawImperativeAPI): ExcalidrawElement[] {
  const selected = api.getAppState().selectedElementIds;
  return api.getSceneElements().filter((el) => selected[el.id] && !el.isDeleted);
}

function applyElementPatch(
  api: ExcalidrawImperativeAPI,
  patchById: Map<string, Partial<ExcalidrawElement>>,
) {
  const nextElements = api.getSceneElements().map((el) => {
    const patch = patchById.get(el.id);
    if (!patch) return el;
    return newElementWith(el, patch);
  });
  api.updateScene({
    elements: nextElements,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

type AlignMode = "left" | "centerX" | "right" | "top" | "centerY" | "bottom";

function alignSelected(api: ExcalidrawImperativeAPI, mode: AlignMode) {
  const selected = selectedElements(api).filter(
    (el) => el.type !== "arrow" && el.type !== "line" && el.type !== "freedraw",
  );
  if (selected.length < 2) return;
  const [minX, minY, maxX, maxY] = getCommonBounds(selected);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const patch = new Map<string, Partial<ExcalidrawElement>>();
  for (const el of selected) {
    if (mode === "left") patch.set(el.id, { x: minX });
    else if (mode === "right") patch.set(el.id, { x: maxX - el.width });
    else if (mode === "centerX") patch.set(el.id, { x: midX - el.width / 2 });
    else if (mode === "top") patch.set(el.id, { y: minY });
    else if (mode === "bottom") patch.set(el.id, { y: maxY - el.height });
    else if (mode === "centerY") patch.set(el.id, { y: midY - el.height / 2 });
  }
  applyElementPatch(api, patch);
}

function distributeSelected(api: ExcalidrawImperativeAPI, axis: "x" | "y") {
  const selected = selectedElements(api).filter(
    (el) => el.type !== "arrow" && el.type !== "line" && el.type !== "freedraw",
  );
  if (selected.length < 3) return;
  const sorted = [...selected].sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (axis === "x") {
    const start = first.x;
    const end = last.x + last.width;
    const totalWidth = sorted.reduce((sum, el) => sum + el.width, 0);
    const gap = (end - start - totalWidth) / (sorted.length - 1);
    let cursor = start;
    const patch = new Map<string, Partial<ExcalidrawElement>>();
    for (const el of sorted) {
      patch.set(el.id, { x: cursor });
      cursor += el.width + gap;
    }
    applyElementPatch(api, patch);
  } else {
    const start = first.y;
    const end = last.y + last.height;
    const totalHeight = sorted.reduce((sum, el) => sum + el.height, 0);
    const gap = (end - start - totalHeight) / (sorted.length - 1);
    let cursor = start;
    const patch = new Map<string, Partial<ExcalidrawElement>>();
    for (const el of sorted) {
      patch.set(el.id, { y: cursor });
      cursor += el.height + gap;
    }
    applyElementPatch(api, patch);
  }
}

function snapSelectedToGrid(api: ExcalidrawImperativeAPI, size = GRID_SIZE) {
  const selected = selectedElements(api);
  if (selected.length === 0) return;
  const patch = new Map<string, Partial<ExcalidrawElement>>();
  for (const el of selected) {
    patch.set(el.id, {
      x: Math.round(el.x / size) * size,
      y: Math.round(el.y / size) * size,
    });
  }
  applyElementPatch(api, patch);
}

function insertTemplate(api: ExcalidrawImperativeAPI, id: CanvasTemplateId) {
  const fresh = buildCanvasTemplateElements(id);
  const existing = api.getSceneElements();
  let offsetX = 0;
  if (existing.some((el) => !el.isDeleted)) {
    const [, , maxX] = getCommonBounds(existing.filter((el) => !el.isDeleted));
    offsetX = maxX + 80;
  }
  const shifted =
    offsetX === 0
      ? fresh
      : fresh.map((el) => newElementWith(el, { x: el.x + offsetX }));
  const selectedIds: Record<string, true> = {};
  for (const el of shifted) selectedIds[el.id] = true;
  api.updateScene({
    elements: [...existing, ...shifted],
    appState: { selectedElementIds: selectedIds },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  api.scrollToContent(shifted, { fitToContent: true, animate: true });
}

export function CanvasLayoutBar({
  api,
  prefs,
  onPrefsChange,
  disabled,
  selectionTick: _selectionTick = 0,
  title,
}: Props) {
  void _selectionTick;
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const selectedIds = api?.getAppState().selectedElementIds ?? {};
  const anySelected = Object.values(selectedIds).some(Boolean);
  const selected = api ? selectedElements(api) : [];
  const fillColor =
    selected.find((el) => "backgroundColor" in el)?.backgroundColor?.toString() ?? null;
  const strokeColor =
    selected.find((el) => "strokeColor" in el)?.strokeColor?.toString() ?? null;

  const setPrefs = (patch: Partial<CanvasLayoutPrefs>) => {
    const next = { ...prefs, ...patch };
    onPrefsChange(next);
  };

  const applyFill = (hex: string | null) => {
    if (!api || !hex || !anySelected || disabled) return;
    const selectedMap = api.getAppState().selectedElementIds;
    const nextElements = api.getSceneElements().map((el) => {
      if (!selectedMap[el.id]) return el;
      if (!("backgroundColor" in el)) return el;
      return newElementWith(el, {
        backgroundColor: hex,
        fillStyle: "solid",
      });
    });
    api.updateScene({
      elements: nextElements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const applyStroke = (hex: string | null) => {
    if (!api || !hex || !anySelected || disabled) return;
    const selectedMap = api.getAppState().selectedElementIds;
    const nextElements = api.getSceneElements().map((el) => {
      if (!selectedMap[el.id]) return el;
      if (!("strokeColor" in el)) return el;
      return newElementWith(el, { strokeColor: hex });
    });
    api.updateScene({
      elements: nextElements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const exportPng = async () => {
    if (!api || disabled) return;
    const blob = await exportToBlob({
      elements: api.getSceneElements(),
      appState: {
        ...api.getAppState(),
        exportBackground: true,
      },
      files: api.getFiles(),
      mimeType: "image/png",
    });
    downloadBlob(blob, `${safeExportBasename(title)}.png`);
  };

  const exportSvg = async () => {
    if (!api || disabled) return;
    const svg = await exportToSvg({
      elements: api.getSceneElements(),
      appState: {
        ...api.getAppState(),
        exportBackground: true,
      },
      files: api.getFiles(),
    });
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    });
    downloadBlob(blob, `${safeExportBasename(title)}.svg`);
  };

  const layoutDisabled = disabled || !api || !anySelected;

  return (
    <div className="canvas-assist" role="toolbar" aria-label="Canvas layout assists">
      <div className="canvas-assist__group">
        <AssistBtn
          label="Grid"
          title="Show grid"
          active={prefs.grid}
          disabled={disabled}
          onClick={() => setPrefs({ grid: !prefs.grid })}
        />
        <AssistBtn
          label="Snap"
          title="Snap selection to grid"
          disabled={layoutDisabled}
          onClick={() => api && snapSelectedToGrid(api)}
        />
      </div>

      <div className="canvas-assist__group" title="Align selection">
        <AssistBtn
          label="⫷"
          title="Align left"
          disabled={layoutDisabled}
          onClick={() => api && alignSelected(api, "left")}
        />
        <AssistBtn
          label="☰"
          title="Align center horizontally"
          disabled={layoutDisabled}
          onClick={() => api && alignSelected(api, "centerX")}
        />
        <AssistBtn
          label="⫸"
          title="Align right"
          disabled={layoutDisabled}
          onClick={() => api && alignSelected(api, "right")}
        />
        <AssistBtn
          label="⬆"
          title="Align top"
          disabled={layoutDisabled}
          onClick={() => api && alignSelected(api, "top")}
        />
        <AssistBtn
          label="⬇"
          title="Align bottom"
          disabled={layoutDisabled}
          onClick={() => api && alignSelected(api, "bottom")}
        />
      </div>

      <div className="canvas-assist__group" title="Distribute selection">
        <AssistBtn
          label="⇔"
          title="Distribute horizontally"
          disabled={layoutDisabled}
          onClick={() => api && distributeSelected(api, "x")}
        />
        <AssistBtn
          label="⇕"
          title="Distribute vertically"
          disabled={layoutDisabled}
          onClick={() => api && distributeSelected(api, "y")}
        />
      </div>

      <div
        className={`canvas-assist__group canvas-assist__color${!anySelected || disabled ? " is-disabled" : ""}`}
      >
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          Fill
        </span>
        <ColorPopover
          color={fillColor}
          label="Shape fill"
          openOn="click"
          allowClear={false}
          onChange={applyFill}
        />
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          Stroke
        </span>
        <ColorPopover
          color={strokeColor}
          label="Shape stroke"
          openOn="click"
          allowClear={false}
          onChange={applyStroke}
        />
      </div>

      <div className="canvas-assist__group canvas-assist__templates">
        <AssistBtn
          label="Templates"
          title="Insert diagram template"
          disabled={disabled || !api}
          active={templatesOpen}
          onClick={() => setTemplatesOpen((o) => !o)}
        />
        {templatesOpen && api && !disabled ? (
          <div className="canvas-assist__menu" role="menu">
            {CANVAS_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="canvas-assist__menu-item"
                role="menuitem"
                title={t.description}
                onClick={() => {
                  insertTemplate(api, t.id);
                  setTemplatesOpen(false);
                }}
              >
                <strong>{t.label}</strong>
                <span className="muted">{t.description}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="canvas-assist__group" title="Export">
        <AssistBtn
          label="PNG"
          title="Export PNG"
          disabled={disabled}
          onClick={() => void exportPng()}
        />
        <AssistBtn
          label="SVG"
          title="Export SVG"
          disabled={disabled}
          onClick={() => void exportSvg()}
        />
      </div>
    </div>
  );
}
