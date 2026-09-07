import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorker;

/** Fallback display title from a filename, without a trailing .pdf. */
export function titleFromPdfFilename(name: string): string {
  const base = name.replace(/\.pdf$/i, "").trim();
  return base || "Untitled PDF";
}

/**
 * Read the PDF Info dictionary Title via pdf.js.
 * Returns null when metadata is missing or the file is not a readable PDF.
 */
export async function extractPdfTitle(file: File | ArrayBuffer): Promise<string | null> {
  try {
    const data = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(file);
    const loadingTask = getDocument({ data, useSystemFonts: true });
    const pdf = await loadingTask.promise;
    try {
      const meta = await pdf.getMetadata();
      const info = meta?.info as { Title?: unknown } | undefined;
      const raw = typeof info?.Title === "string" ? info.Title.trim() : "";
      return raw || null;
    } finally {
      await pdf.destroy();
    }
  } catch {
    return null;
  }
}

/** Prefer PDF Info title; otherwise filename without .pdf. */
export async function resolvePdfDocumentTitle(file: File): Promise<string> {
  const meta = await extractPdfTitle(file);
  if (meta) return meta;
  return titleFromPdfFilename(file.name);
}
