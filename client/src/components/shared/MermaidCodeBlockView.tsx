import { useEffect, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import mermaid from "mermaid";
import { ensureMermaidInitialized } from "../../lib/mermaidInit";
import { randomShortId } from "../../lib/randomId";

const MERMAID_LANG = /^(?:mermaid|mmd|mindmap)$/i;

function isMermaidLanguage(language: string | null | undefined): boolean {
  return Boolean(language && MERMAID_LANG.test(language));
}

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk [\d]+ failed/i.test(
    msg,
  );
}

export function MermaidCodeBlockView({ node, editor, selected }: NodeViewProps) {
  const language = node.attrs.language as string | null;
  const blockId = (node.attrs.id as string | undefined) ?? randomShortId("m");
  const source = node.textContent.trim();
  const diagramRef = useRef<HTMLDivElement>(null);
  const [editable, setEditable] = useState(() => editor.isEditable);
  const [chunkLoadFailed, setChunkLoadFailed] = useState(false);
  const showDiagram = isMermaidLanguage(language) && !editable;

  useEffect(() => {
    const syncEditable = () => setEditable(editor.isEditable);
    // setEditable() emits "update" only; content changes emit "transaction".
    editor.on("update", syncEditable);
    editor.on("transaction", syncEditable);
    return () => {
      editor.off("update", syncEditable);
      editor.off("transaction", syncEditable);
    };
  }, [editor]);

  useEffect(() => {
    if (!showDiagram || !source || !diagramRef.current) return;

    ensureMermaidInitialized();
    const host = diagramRef.current;
    let cancelled = false;
    setChunkLoadFailed(false);

    void (async () => {
      try {
        const renderId = `mermaid-${blockId}-${Date.now()}`;
        const { svg } = await mermaid.render(renderId, source);
        if (cancelled) return;
        host.innerHTML = svg;
        host.classList.remove("md-mermaid--error");
        setChunkLoadFailed(false);
      } catch (err) {
        if (cancelled) return;
        host.innerHTML = "";
        if (isChunkLoadError(err)) {
          setChunkLoadFailed(true);
          return;
        }
        setChunkLoadFailed(false);
        host.classList.add("md-mermaid--error");
        host.textContent = err instanceof Error ? err.message : "Mermaid render failed";
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blockId, showDiagram, source]);

  if (!isMermaidLanguage(language)) {
    const className = language ? `language-${language}` : undefined;
    return (
      <NodeViewWrapper as="pre">
        <NodeViewContent<"code"> as="code" className={className} />
      </NodeViewWrapper>
    );
  }

  if (showDiagram) {
    return (
      <NodeViewWrapper as="div" className="md-mermaid-wrap">
        <div
          ref={diagramRef}
          className="md-mermaid"
          data-mermaid-id={blockId}
          hidden={chunkLoadFailed}
        />
        {chunkLoadFailed ? (
          <div className="md-mermaid md-mermaid--error md-mermaid--reload">
            <p>Diagram assets are out of date (often after a deploy). Reload to fetch the current build.</p>
            <button type="button" className="btn small" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        ) : null}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="pre" className={selected ? "md-mermaid-source is-selected" : "md-mermaid-source"}>
      <NodeViewContent<"code"> as="code" className="language-mermaid" />
    </NodeViewWrapper>
  );
}
