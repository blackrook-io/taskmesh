import CodeBlock from "@tiptap/extension-code-block";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { randomShortId } from "../../lib/randomId";
import { MermaidCodeBlockView } from "./MermaidCodeBlockView";

/** Code blocks with Mermaid diagram preview for ` ```mermaid ` fences. */
export const MermaidCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: () => randomShortId("m"),
        parseHTML: (element) => element.getAttribute("data-id") || randomShortId("m"),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { "data-id": attributes.id };
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidCodeBlockView);
  },
});
