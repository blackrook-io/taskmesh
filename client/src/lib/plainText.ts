import { stripHtmlTags } from "./sanitizeMarkdown";

/** Strip HTML tags from a single-line field. Keep in sync with `src/lib/plainText.ts`. */
export function sanitizePlainText(input: string): string {
  return stripHtmlTags(input);
}
