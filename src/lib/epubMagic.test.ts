import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EPUB_MIME, sniffEpubZip } from "./epubMagic.js";

/** Minimal ZIP local header + stored `mimetype` entry (EPUB-shaped). */
function epubHead(): Buffer {
  const name = Buffer.from("mimetype", "ascii");
  const content = Buffer.from(EPUB_MIME, "ascii");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(0, 8); // stored
  header.writeUInt16LE(0, 10); // mod time
  header.writeUInt16LE(0, 12); // mod date
  header.writeUInt32LE(0, 14); // crc (unchecked for sniff)
  header.writeUInt32LE(content.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28); // extra len
  return Buffer.concat([header, name, content]);
}

describe("epubMagic", () => {
  it("detects EPUB mimetype entry", () => {
    assert.equal(sniffEpubZip(epubHead()), true);
  });

  it("rejects bare ZIP local header without mimetype", () => {
    assert.equal(sniffEpubZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])), false);
  });

  it("rejects non-zip", () => {
    assert.equal(sniffEpubZip(Buffer.from([0xff, 0xd8, 0xff])), false);
  });

  it("rejects ZIP whose first entry is not mimetype", () => {
    const name = Buffer.from("META-INF/", "ascii");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    assert.equal(sniffEpubZip(Buffer.concat([header, name])), false);
  });

  it("exports EPUB mime", () => {
    assert.equal(EPUB_MIME, "application/epub+zip");
  });
});
