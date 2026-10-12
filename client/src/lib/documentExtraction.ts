import type { DocumentKind, DocumentExtraction } from "../types";

/** Status line for a PDF or EPUB. Null for Markdown and for files not yet queued. */
export function documentExtractionStatus(doc: {
  kind: DocumentKind;
  extraction?: DocumentExtraction | null;
}): string | null {
  if (doc.kind !== "pdf" && doc.kind !== "epub") return null;
  const extraction = doc.extraction;
  if (!extraction) return null;
  if (extraction.status === "pending") return "Extracting text…";
  if (extraction.status === "failed") return extraction.errorMessage || "Text extraction failed.";
  if (extraction.status === "empty") {
    return extraction.errorMessage || "No text could be extracted.";
  }
  const unit = doc.kind === "pdf" ? "page" : "chapter";
  const count = extraction.unitCount;
  const label = `${count} ${unit}${count === 1 ? "" : "s"}`;
  const truncated = extraction.truncated ? " (truncated)" : "";
  return `Text extracted · ${label}${truncated}`;
}
