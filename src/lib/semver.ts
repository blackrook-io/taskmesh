/** Numeric major.minor.patch from a version or GitHub tag (`v` prefix allowed). */
export function parseSemver(raw: string): [number, number, number] | null {
  const match = raw.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:\D|$)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Positive when `left` is newer than `right`. Null when either side is not SemVer. */
export function compareSemver(left: string, right: string): number | null {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

export function semverDisplay(raw: string): string | null {
  const parts = parseSemver(raw);
  return parts ? parts.join(".") : null;
}
