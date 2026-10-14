/**
 * Plain text from live Excalidraw text elements, for mention sync.
 * Deleted elements, frames, and other shapes are omitted.
 */
export function canvasMentionText(document: unknown): string {
  if (!document || typeof document !== "object") return "";
  const elements = (document as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return "";
  const parts: string[] = [];
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const row = element as {
      type?: unknown;
      isDeleted?: unknown;
      text?: unknown;
      originalText?: unknown;
    };
    if (row.type !== "text" || row.isDeleted === true) continue;
    if (typeof row.text === "string") parts.push(row.text);
    else if (typeof row.originalText === "string") parts.push(row.originalText);
  }
  return parts.join("\n");
}
