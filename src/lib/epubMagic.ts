/** EPUB is a ZIP container; ZIP local-file header magic. */
const ZIP_LOCAL = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** Empty / spanned ZIP. */
const ZIP_EMPTY = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

export const EPUB_MIME = "application/epub+zip";

/** True when the buffer looks like a ZIP (EPUB container). */
export function sniffEpubZip(head: Buffer): boolean {
  if (head.length < 4) return false;
  return head.subarray(0, 4).equals(ZIP_LOCAL) || head.subarray(0, 4).equals(ZIP_EMPTY);
}
