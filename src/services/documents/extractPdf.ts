import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  DEFAULT_EXTRACT_LIMITS,
  EMPTY_PDF_MESSAGE,
  type ExtractLimits,
  type ExtractOutcome,
  type ExtractSpan,
} from "./extractTypes.js";

type TextItem = { str?: string };

export async function extractPdf(
  bytes: Uint8Array,
  limits: ExtractLimits = DEFAULT_EXTRACT_LIMITS,
): Promise<ExtractOutcome> {
  const loadingTask = getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: true,
    disableWorker: true,
  } as Parameters<typeof getDocument>[0]);
  try {
    const doc = await loadingTask.promise;
    const pageCount = doc.numPages;
    const spans: ExtractSpan[] = [];
    let charCount = 0;
    let truncated = pageCount > limits.maxUnits;
    const lastPage = Math.min(pageCount, limits.maxUnits);

    for (let pageNo = 1; pageNo <= lastPage; pageNo += 1) {
      if (charCount >= limits.maxChars) {
        truncated = true;
        break;
      }
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const text = pageText(content.items as TextItem[]);
      page.cleanup();
      if (!text) continue;
      const room = limits.maxChars - charCount;
      const stored = text.length > room ? text.slice(0, room) : text;
      if (stored.length < text.length) truncated = true;
      spans.push({
        ordinal: spans.length + 1,
        locator: pageNo,
        label: `Page ${pageNo}`,
        text: stored,
      });
      charCount += stored.length;
      if (stored.length < text.length) break;
    }

    if (spans.length === 0) {
      return {
        status: "empty",
        spans: [],
        unitCount: pageCount,
        charCount: 0,
        truncated: false,
        errorMessage: EMPTY_PDF_MESSAGE,
      };
    }
    return {
      status: "ready",
      spans,
      unitCount: pageCount,
      charCount,
      truncated,
      errorMessage: null,
    };
  } finally {
    await loadingTask.destroy();
  }
}

function pageText(items: TextItem[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (typeof item.str === "string" && item.str.trim()) parts.push(item.str);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
