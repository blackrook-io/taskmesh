import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readStrongEnvKey } from "./envKeys.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export class OauthCredentialsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OauthCredentialsKeyError";
  }
}

/** Derive a 32-byte AES key from OAUTH_CREDENTIALS_KEY (min 32 chars when set). */
export function getOauthCredentialsKey(): Buffer {
  let raw: string | null;
  try {
    raw = readStrongEnvKey("OAUTH_CREDENTIALS_KEY");
  } catch (err) {
    throw new OauthCredentialsKeyError(err instanceof Error ? err.message : String(err));
  }
  if (!raw) {
    throw new OauthCredentialsKeyError(
      "OAUTH_CREDENTIALS_KEY is not set. Set it in the environment before enabling OAuth providers.",
    );
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function hasOauthCredentialsKey(): boolean {
  try {
    return readStrongEnvKey("OAUTH_CREDENTIALS_KEY") != null;
  } catch {
    return false;
  }
}

/** Encrypt plaintext → base64url(iv || tag || ciphertext). */
export function encryptOauthSecret(plaintext: string): string {
  const key = getOauthCredentialsKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptOauthSecret(payload: string): string {
  const key = getOauthCredentialsKey();
  const buf = Buffer.from(payload, "base64url");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new OauthCredentialsKeyError("Invalid encrypted secret payload.");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
