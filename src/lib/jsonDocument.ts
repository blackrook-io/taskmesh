import { z } from "zod";

export const JSON_DOCUMENT_MAX_BYTES = 2_000_000;

export function jsonDocumentByteLength(doc: unknown): number {
  return Buffer.byteLength(JSON.stringify(doc), "utf8");
}

export const jsonDocumentSchema = z.record(z.string(), z.unknown()).refine((doc) => {
  return jsonDocumentByteLength(doc) <= JSON_DOCUMENT_MAX_BYTES;
}, `document exceeds ${JSON_DOCUMENT_MAX_BYTES} bytes`);
