import { createHash, randomBytes } from "node:crypto";

export type ApiKeyAccess = "readonly" | "readwrite";

function accessToken(access: ApiKeyAccess): "ro" | "rw" {
  return access === "readonly" ? "ro" : "rw";
}

/** Hash the full secret for storage. */
export function hashApiKeySecret(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

/**
 * Generate a key: `taskmesh_{ro|rw}_{hex}` (~64 bytes of entropy in the secret).
 * Returns the one-time raw key and display prefix (without the long secret).
 */
export function generateApiKey(access: ApiKeyAccess): {
  rawKey: string;
  prefix: string;
  keyHash: string;
} {
  const secret = randomBytes(32).toString("hex"); // 64 hex chars
  const short = secret.slice(0, 8);
  const tag = accessToken(access);
  const prefix = `taskmesh_${tag}_${short}`;
  const rawKey = `taskmesh_${tag}_${secret}`;
  return { rawKey, prefix, keyHash: hashApiKeySecret(rawKey) };
}
