import { isAllowedHref } from "./safeHref.js";

/**
 * Drop HTML tags. Keep Markdown autolinks (`<https://…>`, `<http://…>`, `<mailto:…>`).
 */
export function stripHtmlTags(input: string): string {
  return input.replace(/<\/?(?!https?:|mailto:)[a-zA-Z][^>]*>/gi, "");
}

function rewriteHref(raw: string): string {
  const url = raw.trim();
  if (isAllowedHref(url)) return url;
  return "#";
}

/**
 * Keep GFM-ish Markdown; drop HTML and rewrite unsafe link/image targets.
 */
export function sanitizeMarkdown(input: string): string {
  let s = stripHtmlTags(input);
  s = s.replace(
    /(!?\[[^\]]*]\()([^)\s]+)(\s+"[^"]*")?(\))/g,
    (_m, pre: string, href: string, title: string | undefined, close: string) =>
      `${pre}${rewriteHref(href)}${title ?? ""}${close}`,
  );
  s = s.replace(
    /^(\s*\[[^\]]+]:\s+)(\S+)/gm,
    (_m, pre: string, href: string) => `${pre}${rewriteHref(href)}`,
  );
  s = s.replace(/<(https?:\/\/[^>\s]+)>/gi, (_m, href: string) => {
    const next = rewriteHref(href);
    return next === "#" ? "" : `<${next}>`;
  });
  return s;
}

export function optionalSanitizeMarkdown(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  return sanitizeMarkdown(value);
}
