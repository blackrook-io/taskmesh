/** EPUB is a ZIP container; ZIP local-file header magic. */
const ZIP_LOCAL = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export const EPUB_MIME = "application/epub+zip";

/** Bytes needed to validate the mandatory uncompressed `mimetype` first entry. */
export const EPUB_SNIFF_BYTES = 128;

/**
 * True when the buffer looks like an EPUB: ZIP local header whose first entry
 * is the stored (uncompressed) `mimetype` file with content `application/epub+zip`.
 * Plain ZIPs without that entry are rejected.
 */
export function sniffEpubZip(head: Buffer): boolean {
  if (head.length < 38) return false;
  if (!head.subarray(0, 4).equals(ZIP_LOCAL)) return false;

  const compressionMethod = head.readUInt16LE(8);
  // EPUB requires the mimetype entry to be stored (method 0), not deflated.
  if (compressionMethod !== 0) return false;

  const nameLen = head.readUInt16LE(26);
  const extraLen = head.readUInt16LE(28);
  if (nameLen !== 8) return false; // "mimetype"
  if (head.length < 30 + nameLen) return false;
  const name = head.subarray(30, 30 + nameLen).toString("ascii");
  if (name !== "mimetype") return false;

  const dataStart = 30 + nameLen + extraLen;
  const mime = EPUB_MIME;
  if (head.length < dataStart + mime.length) return false;
  return head.subarray(dataStart, dataStart + mime.length).toString("ascii") === mime;
}
