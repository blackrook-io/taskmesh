import { z } from "zod";
import { optionalSanitizeMarkdown, sanitizeMarkdown } from "./sanitizeMarkdown.js";
import { sanitizePlainText } from "./plainText.js";

export function markdownString(max: number) {
  return z.string().max(max).transform(sanitizeMarkdown);
}

export function optionalMarkdown(max: number) {
  return z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((s) => optionalSanitizeMarkdown(s));
}

/** Title/name: strip HTML, trim, require remaining text. */
export function plainTitle(max: number) {
  return z
    .string()
    .max(max)
    .transform((s) => sanitizePlainText(s).trim())
    .refine((s) => s.length >= 1, { message: "Required" });
}

export function optionalPlainTitle(max: number) {
  return z
    .string()
    .max(max)
    .optional()
    .transform((s) => (s === undefined ? undefined : sanitizePlainText(s).trim()))
    .refine((s) => s === undefined || s.length >= 1, { message: "Required" });
}
