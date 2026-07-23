import { useEffect, useRef, useState } from "react";
import {
  Tldraw,
  createTLStore,
  getSnapshot,
  loadSnapshot,
  type Editor,
  type TLEditorSnapshot,
  type TLStoreSnapshot,
} from "tldraw";
import "tldraw/tldraw.css";
import {
  applyCanvasLayoutPrefs,
  CanvasLayoutBar,
  loadCanvasLayoutPrefs,
  saveCanvasLayoutPrefs,
  type CanvasLayoutPrefs,
} from "./CanvasLayoutBar";

type Props = {
  canvasId: number;
  /** Persisted tldraw document snapshot (or empty object). */
  document: Record<string, unknown>;
  readOnly?: boolean;
  onSaveDocument: (document: Record<string, unknown>) => void;
};

function isNonEmptySnapshot(doc: Record<string, unknown>): boolean {
  return doc != null && typeof doc === "object" && Object.keys(doc).length > 0;
}

export function CanvasEditor({ canvasId, document, readOnly = false, onSaveDocument }: Props) {
  const editorRef = useRef<Editor | null>(null);
  const saveRef = useRef(onSaveDocument);
  saveRef.current = onSaveDocument;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selectionTick, setSelectionTick] = useState(0);
  const [prefs, setPrefs] = useState<CanvasLayoutPrefs>(() => loadCanvasLayoutPrefs());

  const [store] = useState(() => {
    const next = createTLStore();
    if (isNonEmptySnapshot(document)) {
      try {
        loadSnapshot(next, document as unknown as TLEditorSnapshot | TLStoreSnapshot);
      } catch (err) {
        console.warn("Could not restore canvas snapshot", err);
      }
    }
    return next;
  });

  useEffect(() => {
    editorRef.current?.updateInstanceState({ isReadonly: readOnly });
  }, [readOnly]);

  useEffect(() => {
    if (!editor) return;
    applyCanvasLayoutPrefs(editor, prefs);
  }, [editor, prefs]);

  useEffect(() => {
    if (!editor) return;
    const unsub = editor.store.listen(
      () => setSelectionTick((n) => n + 1),
      { scope: "session" },
    );
    return () => unsub();
  }, [editor]);

  useEffect(() => {
    if (readOnly) return;
    let timer: number | undefined;
    const unsub = store.listen(
      () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          const { document: doc } = getSnapshot(store);
          saveRef.current(doc as unknown as Record<string, unknown>);
        }, 900);
      },
      { source: "user", scope: "document" },
    );
    return () => {
      window.clearTimeout(timer);
      unsub();
    };
  }, [store, readOnly, canvasId]);

  const onPrefsChange = (next: CanvasLayoutPrefs) => {
    setPrefs(next);
    saveCanvasLayoutPrefs(next);
  };

  return (
    <div className={`canvas-editor-shell${readOnly ? " canvas-editor-shell--readonly" : ""}`}>
      {!readOnly ? (
        <CanvasLayoutBar
          key={selectionTick}
          editor={editor}
          prefs={prefs}
          onPrefsChange={onPrefsChange}
          disabled={!editor}
        />
      ) : null}
      <div className={`canvas-editor${readOnly ? " canvas-editor--readonly" : ""}`}>
        <Tldraw
          store={store}
          onMount={(ed) => {
            editorRef.current = ed;
            setEditor(ed);
            ed.updateInstanceState({ isReadonly: readOnly });
            applyCanvasLayoutPrefs(ed, loadCanvasLayoutPrefs());
          }}
        />
      </div>
    </div>
  );
}
