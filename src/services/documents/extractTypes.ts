export const EXTRACT_MAX_UNITS = 2_000;
export const EXTRACT_MAX_CHARS = 2_000_000;

export const EMPTY_PDF_MESSAGE =
  "No text layer. This looks like a scanned PDF; OCR is not available.";
export const EMPTY_EPUB_MESSAGE = "No chapter text found.";

export type ExtractLimits = {
  maxUnits: number;
  maxChars: number;
};

export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxUnits: EXTRACT_MAX_UNITS,
  maxChars: EXTRACT_MAX_CHARS,
};

export type ExtractSpan = {
  ordinal: number;
  locator: number;
  label: string;
  text: string;
};

export type ExtractOutcome = {
  status: "ready" | "empty";
  spans: ExtractSpan[];
  unitCount: number;
  charCount: number;
  truncated: boolean;
  errorMessage: string | null;
};

export function extractionFailureMessage(kind: "pdf" | "epub", err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "";
  if (kind === "pdf" && (name === "PasswordException" || /password/i.test(message))) {
    return "Password-protected PDFs cannot be extracted.";
  }
  if (kind === "pdf") return "Could not read this PDF.";
  return "Could not read this EPUB.";
}
