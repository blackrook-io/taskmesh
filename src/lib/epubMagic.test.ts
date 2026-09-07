import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EPUB_MIME, sniffEpubZip } from "./epubMagic.js";

describe("epubMagic", () => {
  it("detects ZIP local header", () => {
    assert.equal(sniffEpubZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])), true);
  });

  it("rejects non-zip", () => {
    assert.equal(sniffEpubZip(Buffer.from([0xff, 0xd8, 0xff])), false);
  });

  it("exports EPUB mime", () => {
    assert.equal(EPUB_MIME, "application/epub+zip");
  });
});
