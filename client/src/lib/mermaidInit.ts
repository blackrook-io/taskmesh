import mermaid from "mermaid";

let initialized = false;

/** One-time Mermaid setup for in-editor diagram preview (erDiagram, flowchart, etc.). */
export function ensureMermaidInitialized(): void {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "strict",
    er: {
      useMaxWidth: true,
    },
  });
  initialized = true;
}
