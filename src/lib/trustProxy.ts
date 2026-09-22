/**
 * Parse `TRUST_PROXY` for Express `app.set("trust proxy", …)`.
 *
 * Explicit config only — never inferred from `NODE_ENV`.
 * Unset / empty → `false` (do not trust `X-Forwarded-*`).
 */
export function parseTrustProxy(
  env: NodeJS.ProcessEnv = process.env,
): boolean | number | string {
  const raw = env.TRUST_PROXY?.trim();
  if (raw === undefined || raw === "") return false;

  const lower = raw.toLowerCase();
  if (lower === "0" || lower === "false" || lower === "no" || lower === "off") {
    return false;
  }
  if (lower === "1" || lower === "true" || lower === "yes" || lower === "on") {
    return 1;
  }

  if (/^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }

  // Express also accepts values like "loopback", subnets, etc.
  return raw;
}
