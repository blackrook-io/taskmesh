const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF87 = Buffer.from("GIF87a");
const GIF89 = Buffer.from("GIF89a");

export type AllowedImageMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function startsWith(buf: Buffer, sig: Buffer): boolean {
  return buf.length >= sig.length && buf.subarray(0, sig.length).equals(sig);
}

/** Detect jpeg/png/gif/webp from file bytes. Returns null when unrecognized. */
export function sniffImageMime(buf: Buffer): AllowedImageMime | null {
  if (startsWith(buf, JPEG)) return "image/jpeg";
  if (startsWith(buf, PNG)) return "image/png";
  if (startsWith(buf, GIF87) || startsWith(buf, GIF89)) return "image/gif";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
