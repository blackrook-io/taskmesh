export const PDF_MIME = "application/pdf";

/** True when the buffer starts with the PDF magic (`%PDF`). */
export function sniffPdf(head: Buffer): boolean {
  if (head.length < 4) return false;
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
}
