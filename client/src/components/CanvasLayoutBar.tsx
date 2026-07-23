import {
  CaptureUpdateAction,
  exportToBlob,
  exportToSvg,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ColorPopover } from "./shared/ColorPopover";
import { downloadBlob, safeExportBasename } from "../lib/excalidrawScene";

const PREFS_KEY = "taskmesh.canvas.layout";

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

export function CanvasLayoutBar({
  api,
  prefs,
  onPrefsChange,
  disabled,
  selectionTick: _selectionTick = 0,
  title,
}: Props) {
  void _selectionTick;
  const selectedIds = api?.getAppState().selectedElementIds ?? {};
  const anySelected = Object.values(selectedIds).some(Boolean);

  const setPrefs = (patch: Partial<CanvasLayoutPrefs>) => {
    const next = { ...prefs, ...patch };
    onPrefsChange(next);
  };

  const applyFill = (hex: string | null) => {
    if (!api || !hex || !anySelected || disabled) return;
    const selected = api.getAppState().selectedElementIds;
    const nextElements = api.getSceneElements().map((el) => {
      if (!selected[el.id]) return el;
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
      </div>

      <div
        className={`canvas-assist__group canvas-assist__color${!anySelected || disabled ? " is-disabled" : ""}`}
      >
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          Fill
        </span>
        <ColorPopover
          color={null}
          label="Shape fill"
          openOn="click"
          allowClear={false}
          onChange={applyFill}
        />
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
