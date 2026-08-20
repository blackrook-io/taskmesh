const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Same-origin relative paths (`/api/v1/files/...`) are allowed.
 * Protocol-relative (`//evil`) and dangerous schemes are not.
 */
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
