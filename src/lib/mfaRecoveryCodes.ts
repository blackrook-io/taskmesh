import { createHash, randomInt } from "node:crypto";

/** Alphabet without ambiguous 0/O/1/I. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RECOVERY_CODE_COUNT = 10;
const SEGMENT_LEN = 4;

export function normalizeRecoveryCode(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function formatRecoveryCode(normalized: string): string {
  const n = normalizeRecoveryCode(normalized);
  if (n.length !== SEGMENT_LEN * 2) return n;
  return `${n.slice(0, SEGMENT_LEN)}-${n.slice(SEGMENT_LEN)}`;
}

export function hashRecoveryCode(raw: string): string {
  const normalized = normalizeRecoveryCode(raw);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function looksLikeRecoveryCode(raw: string): boolean {
  const n = normalizeRecoveryCode(raw);
  return n.length === SEGMENT_LEN * 2 && /^[A-Z0-9]+$/.test(n) && !/^\d{6}$/.test(n);
}

function randomSegment(): string {
  let out = "";
  for (let i = 0; i < SEGMENT_LEN; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)]!;
  }
  return out;
}

/** Generate a display-formatted recovery code (`XXXX-XXXX`). */
export function generateRecoveryCode(): string {
  return `${randomSegment()}-${randomSegment()}`;
}

export function generateRecoveryCodeSet(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  while (codes.length < count) {
    const code = generateRecoveryCode();
    const key = normalizeRecoveryCode(code);
    if (seen.has(key)) continue;
    seen.add(key);
    codes.push(code);
  }
  return codes;
}
