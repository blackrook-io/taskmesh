import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDF_MIME, sniffPdf } from "./pdfMagic.js";

describe("pdfMagic", () => {
  it("detects %PDF header", () => {
    assert.equal(sniffPdf(Buffer.from("%PDF-1.7")), true);
  });

  it("rejects non-pdf", () => {
    assert.equal(sniffPdf(Buffer.from([0xff, 0xd8, 0xff])), false);
  });

  it("exports PDF mime", () => {
    assert.equal(PDF_MIME, "application/pdf");
  });
});
