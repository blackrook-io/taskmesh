import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export class MfaTotpKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MfaTotpKeyError";
  }
}

/** Derive a 32-byte AES key from MFA_TOTP_KEY (any length string). */
export function getMfaTotpKey(): Buffer {
  const raw = process.env.MFA_TOTP_KEY?.trim();
  if (!raw) {
    throw new MfaTotpKeyError(
      "MFA_TOTP_KEY is not set. Set it in the environment before enabling MFA enrollment.",
    );
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function hasMfaTotpKey(): boolean {
  return Boolean(process.env.MFA_TOTP_KEY?.trim());
}

/** Encrypt plaintext → base64url(iv || tag || ciphertext). */
export function encryptMfaSecret(plaintext: string): string {
  const key = getMfaTotpKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptMfaSecret(payload: string): string {
  const key = getMfaTotpKey();
  const buf = Buffer.from(payload, "base64url");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new MfaTotpKeyError("Invalid encrypted MFA secret payload.");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
