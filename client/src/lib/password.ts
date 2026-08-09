/**
 * Client-side password checks mirroring server `src/lib/password.ts`.
 * Server remains authoritative; this is for immediate Profile UX only.
 * Never log or display the plaintext password value in errors.
 */

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

export const PASSWORD_GUIDELINES =
  "Min 12 characters with upper, lower, digit, and symbol. Avoid common words, sequences (abcd, 1234), repeats (aaa), and keyboard runs (qwerty).";

function normalizeForPasswordCheck(password: string): string {
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

/** Returns an error message, or null when acceptable. */
export function validatePasswordClient(password: string): string | null {
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

/** Practical email shape check; server Zod `.email()` is authoritative. */
export function validateEmailClient(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return "Email is required";
  if (trimmed.length > 320) return "Email is too long";
  // Basic RFC-ish local@domain.tld — rejects spaces and missing TLD.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "Enter a valid email address";
  }
  return null;
}
