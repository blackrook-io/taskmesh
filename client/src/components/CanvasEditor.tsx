import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import {
  loadCanvasLayoutPrefs,
  saveCanvasLayoutPrefs,
  CanvasLayoutBar,
  type CanvasLayoutPrefs,
} from "./CanvasLayoutBar";
import { serializeScene, toInitialData } from "../lib/excalidrawScene";

type Props = {
  canvasId: number;
  /** Persisted Excalidraw scene (or legacy/empty object). */
  document: Record<string, unknown>;
  title?: string;
  readOnly?: boolean;
  onSaveDocument: (document: Record<string, unknown>) => void;
};

export function CanvasEditor({
  canvasId,
  document,
  title,
  readOnly = false,
  onSaveDocument,
}: Props) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveRef = useRef(onSaveDocument);
  saveRef.current = onSaveDocument;
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [selectionTick, setSelectionTick] = useState(0);
  const [prefs, setPrefs] = useState<CanvasLayoutPrefs>(() => loadCanvasLayoutPrefs());
  const timerRef = useRef<number | undefined>(undefined);

  const initialData = useMemo(
    () => toInitialData(document, { gridModeEnabled: prefs.grid }),
    // Mount once per canvasId (parent remounts via key).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: load snapshot at mount only
    [canvasId],
  );

  useEffect(() => {
    return () => {
      window.clearTimeout(timerRef.current);
    };
  }, []);

  const scheduleSave = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      if (readOnly) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        saveRef.current(
          serializeScene(elements, appState as unknown as Record<string, unknown>, files),
        );
      }, 900);
    },
    [readOnly],
  );

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      setSelectionTick((n) => n + 1);
      scheduleSave(elements, appState, files);
    },
    [scheduleSave],
  );

  const onApi = useCallback((next: ExcalidrawImperativeAPI) => {
    apiRef.current = next;
    setApi(next);
  }, []);

  const onPrefsChange = (next: CanvasLayoutPrefs) => {
    setPrefs(next);
    saveCanvasLayoutPrefs(next);
    const current = apiRef.current;
    if (!current) return;
    current.updateScene({
      appState: { gridModeEnabled: next.grid },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  };

  return (
    <div className={`canvas-editor-shell${readOnly ? " canvas-editor-shell--readonly" : ""}`}>
      {!readOnly ? (
        <CanvasLayoutBar
          api={api}
          prefs={prefs}
          onPrefsChange={onPrefsChange}
          disabled={!api}
          selectionTick={selectionTick}
          title={title}
        />
      ) : null}
      <div className={`canvas-editor${readOnly ? " canvas-editor--readonly" : ""}`}>
        <Excalidraw
          excalidrawAPI={onApi}
          initialData={initialData}
          theme="dark"
          viewModeEnabled={readOnly}
          zenModeEnabled={false}
          gridModeEnabled={prefs.grid}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: true,
              clearCanvas: !readOnly,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              toggleTheme: false,
            },
          }}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
