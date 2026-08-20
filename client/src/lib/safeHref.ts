const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Keep in sync with `src/lib/safeHref.ts`. */
export function isAllowedHref(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    if (trimmed.toLowerCase().includes("javascript:")) return false;
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  return ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase());
}
