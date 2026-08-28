/** Short random id; works on HTTP LAN dev hosts where `crypto.randomUUID` is unavailable. */
export function randomShortId(prefix = ""): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}
