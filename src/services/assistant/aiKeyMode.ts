export const AI_KEY_MODES = [
  "instance_only",
  "user_only",
  "user_preferred_instance_fallback",
] as const;

export type AiKeyMode = (typeof AI_KEY_MODES)[number];

/** Exact text the Administrator must type. Case-sensitive; surrounding space is ignored. */
export const BILLING_RISK_PHRASE = "I understand and accept";

const RISKY_MODES = new Set<AiKeyMode>(["instance_only", "user_preferred_instance_fallback"]);

export function isAiKeyMode(value: unknown): value is AiKeyMode {
  return typeof value === "string" && (AI_KEY_MODES as readonly string[]).includes(value);
}

export function parseAiKeyMode(value: unknown): AiKeyMode {
  return isAiKeyMode(value) ? value : "instance_only";
}

/**
 * True when switching into a mode that spends the instance key on a multi-user instance.
 * Re-saving the current mode, switching to user_only, and a single active user do not require it.
 */
export function billingAckRequired(args: {
  current: AiKeyMode;
  next: AiKeyMode;
  activeUserCount: number;
}): boolean {
  if (args.next === args.current) return false;
  if (!RISKY_MODES.has(args.next)) return false;
  return args.activeUserCount > 1;
}

export function instanceKeyHint(secret: string): string {
  return secret.trim().slice(-4);
}

/** Remove a stored secret from a provider error before it is returned or logged. */
export function redactSecret(message: string, secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length < 8) return message;
  return message.split(trimmed).join("[redacted]");
}
