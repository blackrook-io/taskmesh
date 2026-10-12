import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { extractEpub } from "./extractEpub.js";
import { extractPdf } from "./extractPdf.js";
import { DOCUMENT_EXTRACT_JOB } from "./extractJob.js";
import { EMPTY_PDF_MESSAGE, extractionFailureMessage } from "./extractTypes.js";

describe("extractPdf", () => {
  it("returns page text with a page locator", async () => {
    const outcome = await extractPdf(buildPdf(["Hello page one", "Second page"]));
    assert.equal(outcome.status, "ready");
    assert.equal(outcome.unitCount, 2);
    assert.equal(outcome.truncated, false);
    assert.deepEqual(
      outcome.spans.map((span) => ({ locator: span.locator, text: span.text })),
      [
        { locator: 1, text: "Hello page one" },
        { locator: 2, text: "Second page" },
      ],
    );
  });

  it("marks a PDF with no text layer empty", async () => {
    const outcome = await extractPdf(buildPdf([""]));
    assert.equal(outcome.status, "empty");
    assert.equal(outcome.spans.length, 0);
    assert.equal(outcome.errorMessage, EMPTY_PDF_MESSAGE);
    assert.equal(outcome.truncated, false);
  });

  it("stops when the character limit is reached", async () => {
    const outcome = await extractPdf(buildPdf(["Hello page one"]), { maxUnits: 10, maxChars: 5 });
    assert.equal(outcome.status, "ready");
    assert.equal(outcome.truncated, true);
    assert.equal(outcome.spans[0]?.text, "Hello");
    assert.equal(outcome.charCount, 5);
  });
});

describe("extractEpub", () => {
  it("returns chapter text in spine order", async () => {
    const outcome = await extractEpub(await buildEpub());
    assert.equal(outcome.status, "ready");
    assert.equal(outcome.unitCount, 2);
    assert.deepEqual(
      outcome.spans.map((span) => ({ locator: span.locator, label: span.label, text: span.text })),
      [
        { locator: 1, label: "Opening", text: "First chapter body" },
        { locator: 2, label: "Later", text: "Second chapter body" },
      ],
    );
  });
});

describe("extraction failures", () => {
  it("describes a password-protected PDF without the raw error", () => {
    const err = new Error("Need a password");
    err.name = "PasswordException";
    assert.equal(
      extractionFailureMessage("pdf", err),
      "Password-protected PDFs cannot be extracted.",
    );
  });
});

describe("document extract job definition", () => {
  it("expires quickly and does not stack", () => {
    assert.equal(DOCUMENT_EXTRACT_JOB.name, "document-extract-text");
    assert.equal(DOCUMENT_EXTRACT_JOB.policy, "short");
    assert.equal(DOCUMENT_EXTRACT_JOB.concurrency, 1);
    assert.equal(DOCUMENT_EXTRACT_JOB.retryLimit, 2);
    assert.equal(DOCUMENT_EXTRACT_JOB.expireInSeconds, 180);
  });
});

function buildPdf(pageTexts: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const push = (value: string) => parts.push(encoder.encode(value));
  const size = () => parts.reduce((total, part) => total + part.length, 0);
  const offsets: number[] = [];
  const add = (body: string) => {
    offsets.push(size());
    push(body);
  };

  push("%PDF-1.4\n");
  const pageCount = pageTexts.length;
  const fontId = 3 + pageCount * 2;
  const kids = pageTexts.map((_, index) => `${3 + index * 2} 0 R`).join(" ");
  add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  add(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`);
  pageTexts.forEach((text, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const stream = text ? `BT /F1 12 Tf 20 100 Td (${escapePdf(text)}) Tj ET` : "BT ET";
    add(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>\nendobj\n`,
    );
    add(
      `${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  });
  add(`${fontId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);

  const xrefAt = size();
  const objectCount = fontId;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  const out = new Uint8Array(size());
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

async function buildEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="nav"/></spine></package>`,
  );
  zip.file(
    "OEBPS/c1.xhtml",
    `<html><head><title>Ignored</title></head><body><h1>Opening</h1><p>First chapter body</p></body></html>`,
  );
  zip.file(
    "OEBPS/c2.xhtml",
    `<html><head><title>Later</title></head><body><h1>Later</h1><p>Second chapter body</p></body></html>`,
  );
  zip.file(
    "OEBPS/nav.xhtml",
    `<html><body><nav>Contents</nav></body></html>`,
  );
  const buf = await zip.generateAsync({ type: "uint8array" });
  return buf;
}
