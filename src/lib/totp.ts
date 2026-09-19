import { TOTP, Secret } from "otpauth";

const ISSUER = "TaskMesh";
const DIGITS = 6;
const PERIOD = 30;
const WINDOW = 1;

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function buildTotp(secretBase32: string, accountLabel: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label: accountLabel,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
}

export function totpUri(secretBase32: string, accountLabel: string): string {
  return buildTotp(secretBase32, accountLabel).toString();
}

/**
 * Verify a TOTP code. Returns the absolute time-step counter on success, or null.
 * Callers should persist the step and reject replays when `step <= lastAcceptedStep`.
 */
export function verifyTotpCode(secretBase32: string, code: string): number | null {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return null;
  const delta = buildTotp(secretBase32, "verify").validate({
    token: cleaned,
    window: WINDOW,
  });
  if (delta === null) return null;
  const currentStep = Math.floor(Date.now() / 1000 / PERIOD);
  return currentStep + delta;
}
