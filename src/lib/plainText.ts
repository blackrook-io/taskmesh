import { stripHtmlTags } from "./sanitizeMarkdown.js";

/** Strip HTML tags from a single-line field (titles, names, tags). Keep in sync with client. */
export function sanitizePlainText(input: string): string {
  return stripHtmlTags(input);
}
