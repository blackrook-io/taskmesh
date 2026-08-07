import { THEME } from "@excalidraw/excalidraw";
import type { BinaryFiles, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * Drawing surface — darker than app chrome (`--bg` / `--surface`) so the canvas
 * reads as a distinct workspace. Matches `--canvas-bg` token intent.
 */
export const CANVAS_BG = "#12131a";

const PERSISTED_APP_STATE_KEYS = [
  "viewBackgroundColor",
  "gridModeEnabled",
  "theme",
] as const;

export type ExcalidrawDocument = {
  elements: readonly ExcalidrawElement[];
  appState?: Record<string, unknown>;
  files?: BinaryFiles;
};

export function isExcalidrawDocument(doc: Record<string, unknown> | null | undefined): doc is ExcalidrawDocument &
  Record<string, unknown> {
  return doc != null && typeof doc === "object" && Array.isArray(doc.elements);
}

function defaultAppState(gridModeEnabled: boolean): NonNullable<ExcalidrawInitialDataState["appState"]> {
  return {
    viewBackgroundColor: CANVAS_BG,
    gridModeEnabled,
    theme: THEME.DARK,
  };
}

/** Build Excalidraw `initialData`. Legacy tldraw snapshots become an empty scene. */
export function toInitialData(
  doc: Record<string, unknown>,
  opts?: { gridModeEnabled?: boolean },
): ExcalidrawInitialDataState {
  const gridModeEnabled = opts?.gridModeEnabled ?? true;
  if (!isExcalidrawDocument(doc)) {
    return {
      elements: [],
      appState: defaultAppState(gridModeEnabled),
      scrollToContent: true,
    };
  }

  const prior =
    doc.appState && typeof doc.appState === "object"
      ? (doc.appState as Record<string, unknown>)
      : {};

  const priorBg =
    typeof prior.viewBackgroundColor === "string" ? prior.viewBackgroundColor : null;
  // Migrate old light paper default to the darker workspace color.
  const viewBackgroundColor =
    !priorBg || priorBg.toLowerCase() === "#f8f9fa" ? CANVAS_BG : priorBg;

  const appState: NonNullable<ExcalidrawInitialDataState["appState"]> = {
    ...defaultAppState(gridModeEnabled),
    ...prior,
    theme: THEME.DARK,
    viewBackgroundColor,
    gridModeEnabled:
      typeof prior.gridModeEnabled === "boolean" ? prior.gridModeEnabled : gridModeEnabled,
  };

  return {
    elements: doc.elements,
    appState,
    files: doc.files ?? {},
    scrollToContent: true,
  };
}

function pickPersistedAppState(appState: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    viewBackgroundColor: CANVAS_BG,
    gridModeEnabled: true,
    theme: THEME.DARK,
  };
  for (const key of PERSISTED_APP_STATE_KEYS) {
    if (key in appState) out[key] = appState[key];
  }
  out.theme = THEME.DARK;
  const bg = out.viewBackgroundColor;
  if (typeof bg !== "string" || bg.toLowerCase() === "#f8f9fa") {
    out.viewBackgroundColor = CANVAS_BG;
  }
  return out;
}

function referencedFileIds(elements: readonly ExcalidrawElement[]): Set<string> {
  const ids = new Set<string>();
  for (const el of elements) {
    if (el.type === "image" && "fileId" in el && typeof el.fileId === "string" && el.fileId) {
      ids.add(el.fileId);
    }
  }
  return ids;
}

/** Serialize scene for Postgres jsonb — strip transient UI appState. */
export function serializeScene(
  elements: readonly ExcalidrawElement[],
  appState: Record<string, unknown>,
  files: BinaryFiles,
): Record<string, unknown> {
  const keep = referencedFileIds(elements);
  const filteredFiles: BinaryFiles = {};
  for (const [id, file] of Object.entries(files ?? {})) {
    if (keep.has(id)) filteredFiles[id] = file;
  }

  return {
    type: "excalidraw",
    version: 2,
    source: "taskmesh",
    elements,
    appState: pickPersistedAppState(appState),
    files: filteredFiles,
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function safeExportBasename(title: string | undefined): string {
  const raw = (title ?? "canvas").trim() || "canvas";
  return raw.replace(/[^\w\-]+/g, "_").slice(0, 80);
}
