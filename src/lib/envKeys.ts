/** Minimum trimmed length for AES KEKs derived via SHA-256. */
export const ENV_KEY_MIN_LENGTH = 32;

export type EnvKeyName = "MFA_TOTP_KEY" | "OAUTH_CREDENTIALS_KEY";

/**
 * When the env var is set, require minimum length. Empty/unset is allowed
 * (features that need the key fail later at first use).
 * Throws a plain Error so startup can refuse to listen.
 */
export function assertEnvKeyStrength(
  name: EnvKeyName,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const raw = env[name]?.trim();
  if (!raw) return;
  if (raw.length < ENV_KEY_MIN_LENGTH) {
    throw new Error(
      `${name} must be at least ${ENV_KEY_MIN_LENGTH} characters when set (got ${raw.length}).`,
    );
  }
}

/** Fail fast at process start for any configured KEK that is too short. */
export function assertConfiguredEnvKeys(env: NodeJS.ProcessEnv = process.env): void {
  assertEnvKeyStrength("MFA_TOTP_KEY", env);
  assertEnvKeyStrength("OAUTH_CREDENTIALS_KEY", env);
}

export function readStrongEnvKey(
  name: EnvKeyName,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  if (raw.length < ENV_KEY_MIN_LENGTH) {
    throw new Error(
      `${name} must be at least ${ENV_KEY_MIN_LENGTH} characters when set (got ${raw.length}).`,
    );
  }
  return raw;
}
