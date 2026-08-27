import { sanitizeMarkdown } from "./sanitizeMarkdown.js";
import { sanitizePlainText } from "./plainText.js";

const SKIP_KEYS = new Set([
  "password",
  "password2",
  "passwordhash",
  "currentpassword",
  "rawkey",
]);
const MARKDOWN_KEYS = new Set(["body", "description", "message", "pagecontext", "content"]);
const MAX_DEPTH = 16;

function skipKey(key: string): boolean {
  return SKIP_KEYS.has(key.toLowerCase());
}

function isMarkdownKey(key: string): boolean {
  return MARKDOWN_KEYS.has(key.toLowerCase());
}

/** Recursively strip HTML from user-supplied JSON/query strings. */
export function sanitizeIncomingValue(value: unknown, key = "", depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;
  if (skipKey(key)) return value;
  if (typeof value === "string") {
    return isMarkdownKey(key) ? sanitizeMarkdown(value) : sanitizePlainText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeIncomingValue(item, key, depth + 1));
  }
  if (value != null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      out[k] = sanitizeIncomingValue(v, k, depth + 1);
    }
    return out;
  }
  return value;
}
