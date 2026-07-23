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

  return (
    <div className={`canvas-editor${readOnly ? " canvas-editor--readonly" : ""}`}>
      <Tldraw
        store={store}
        onMount={(editor) => {
          editorRef.current = editor;
          editor.updateInstanceState({ isReadonly: readOnly });
        }}
      />
    </div>
  );
}
