import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

/** OWASP-aligned cost (2^17). Stored hashes carry N/r/p so older values still verify. */
const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
/** ~128 * N * r ≈ 134 MB; headroom for Node scrypt maxmem checks. */
const MAXMEM = 256 * 1024 * 1024;

/** Cheap denylist — common words / patterns (normalized), not a full dictionary. */
const COMMON_WORDS = [
  "password",
  "passwd",
  "passphrase",
  "welcome",
  "qwerty",
  "qwertyuiop",
  "asdfgh",
  "asdfghjkl",
  "zxcvbn",
  "zxcvbnm",
  "abcdef",
  "abc123",
  "letmein",
  "admin",
  "login",
  "secret",
  "dragon",
  "master",
  "monkey",
  "football",
  "baseball",
  "iloveyou",
  "sunshine",
  "princess",
  "trustno",
  "changeme",
  "temporary",
  "default",
] as const;

const KEYBOARD_RUNS = [
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "1234567890",
  "abcdefghijklmnopqrstuvwxyz",
] as const;

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

/** Lowercase + light leetspeak fold for pattern checks only. */
export function normalizeForPasswordCheck(password: string): string {
  return password
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a")
    .replace(/\$/g, "s");
}

function hasRepeatedChars(password: string): boolean {
  return /(.)\1{2,}/.test(password);
}

function hasSequentialRun(password: string, minLen = 4): boolean {
  const lower = password.toLowerCase();
  for (let i = 0; i <= lower.length - minLen; i++) {
    const slice = lower.slice(i, i + minLen);
    if (!/^[a-z0-9]+$/.test(slice)) continue;
    let asc = true;
    let desc = true;
    for (let j = 1; j < slice.length; j++) {
      const prev = slice.charCodeAt(j - 1);
      const cur = slice.charCodeAt(j);
      if (cur !== prev + 1) asc = false;
      if (cur !== prev - 1) desc = false;
    }
    if (asc || desc) return true;
  }
  return false;
}

function hasKeyboardRun(normalized: string, minLen = 4): boolean {
  for (const row of KEYBOARD_RUNS) {
    const rev = [...row].reverse().join("");
    for (let i = 0; i <= row.length - minLen; i++) {
      const fwd = row.slice(i, i + minLen);
      const back = rev.slice(i, i + minLen);
      if (normalized.includes(fwd) || normalized.includes(back)) return true;
    }
  }
  return false;
}

function hasCommonWord(normalized: string): boolean {
  return COMMON_WORDS.some((word) => normalized.includes(word));
}

/**
 * Password rules shared by Admin reset and Profile (T0062).
 * Returns an error message, or null when acceptable.
 * Never logs or echoes the password value.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 12) {
    return "Password must be at least 12 characters";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must include an uppercase letter";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must include a lowercase letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must include a digit";
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must include a symbol";
  }
  if (hasRepeatedChars(password)) {
    return "Password must not contain repeated characters (e.g. aaa)";
  }
  if (hasSequentialRun(password)) {
    return "Password must not contain sequential characters (e.g. abcd, 1234)";
  }
  const normalized = normalizeForPasswordCheck(password);
  if (hasKeyboardRun(normalized)) {
    return "Password must not contain keyboard patterns (e.g. qwerty)";
  }
  if (hasCommonWord(normalized)) {
    return "Password is too common or uses an identifiable word pattern";
  }
  return null;
}

/** Format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = await scryptAsync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

function parseScryptParts(
  stored: string,
): { N: number; r: number; p: number; salt: Buffer; expected: Buffer } | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every((n) => Number.isFinite(n) && n > 0)) return null;
  try {
    const salt = Buffer.from(parts[4]!, "base64");
    const expected = Buffer.from(parts[5]!, "base64");
    if (salt.length === 0 || expected.length === 0) return null;
    return { N, r, p, salt, expected };
  } catch {
    return null;
  }
}

/** True when the stored hash uses older/weaker parameters than the current targets. */
export function needsPasswordRehash(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parsed = parseScryptParts(stored);
  if (!parsed) return false;
  return parsed.N !== SCRYPT_N || parsed.r !== SCRYPT_R || parsed.p !== SCRYPT_P;
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parsed = parseScryptParts(stored);
  if (!parsed) return false;
  try {
    const derived = await scryptAsync(password, parsed.salt, parsed.expected.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAXMEM,
    });
    if (derived.length !== parsed.expected.length) return false;
    return timingSafeEqual(derived, parsed.expected);
  } catch {
    return false;
  }
}
