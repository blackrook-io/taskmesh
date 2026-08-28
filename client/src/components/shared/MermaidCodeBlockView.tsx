import { useEffect, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import mermaid from "mermaid";
import { ensureMermaidInitialized } from "../../lib/mermaidInit";
import { randomShortId } from "../../lib/randomId";

const MERMAID_LANG = /^(?:mermaid|mmd|mindmap)$/i;

function isMermaidLanguage(language: string | null | undefined): boolean {
  return Boolean(language && MERMAID_LANG.test(language));
}

export function MermaidCodeBlockView({ node, editor, selected }: NodeViewProps) {
  const language = node.attrs.language as string | null;
  const blockId = (node.attrs.id as string | undefined) ?? randomShortId("m");
  const source = node.textContent.trim();
  const diagramRef = useRef<HTMLDivElement>(null);
  const [editable, setEditable] = useState(() => editor.isEditable);
  const showDiagram = isMermaidLanguage(language) && !editable;

  useEffect(() => {
    const syncEditable = () => setEditable(editor.isEditable);
    editor.on("transaction", syncEditable);
    return () => {
      editor.off("transaction", syncEditable);
    };
  }, [editor]);

  useEffect(() => {
    if (!showDiagram || !source || !diagramRef.current) return;

    ensureMermaidInitialized();
    const host = diagramRef.current;
    let cancelled = false;

    void (async () => {
      try {
        const renderId = `mermaid-${blockId}-${Date.now()}`;
        const { svg } = await mermaid.render(renderId, source);
        if (cancelled) return;
        host.innerHTML = svg;
        host.classList.remove("md-mermaid--error");
      } catch (err) {
        if (cancelled) return;
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
        <NodeViewContent<'code'> as="code" className={className} />
      </NodeViewWrapper>
    );
  }

  if (showDiagram) {
    return (
      <NodeViewWrapper as="div" className="md-mermaid-wrap">
        <div ref={diagramRef} className="md-mermaid" data-mermaid-id={blockId} />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="pre" className={selected ? "md-mermaid-source is-selected" : "md-mermaid-source"}>
      <NodeViewContent<'code'> as="code" className="language-mermaid" />
    </NodeViewWrapper>
  );
}
