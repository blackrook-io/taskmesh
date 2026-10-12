export const AI_ACCESS_VALUES = ["full", "read_only", "excluded"] as const;
export type AiAccess = (typeof AI_ACCESS_VALUES)[number];

const RANK: Record<AiAccess, number> = {
  full: 0,
  read_only: 1,
  excluded: 2,
};

export function isAiAccess(value: unknown): value is AiAccess {
  return typeof value === "string" && (AI_ACCESS_VALUES as readonly string[]).includes(value);
}

/** The narrower setting wins. `excluded` is narrower than `read_only`, which is narrower than `full`. */
export function narrowerAiAccess(a: AiAccess, b: AiAccess): AiAccess {
  return RANK[a] >= RANK[b] ? a : b;
}

/** True when `candidate` would allow more AI use than `ceiling`. */
export function aiAccessWiderThan(candidate: AiAccess, ceiling: AiAccess): boolean {
  return RANK[candidate] < RANK[ceiling];
}

export function effectiveAiAccess(stored: AiAccess, ceiling: AiAccess): AiAccess {
  return narrowerAiAccess(stored, ceiling);
}

/** A suggestion or embedding pair is skipped when either project is excluded. */
export function aiPairExcluded(a: AiAccess, b: AiAccess): boolean {
  return a === "excluded" || b === "excluded";
}

export function linksVisibleToAi<T extends { from: AiAccess; to: AiAccess }>(links: readonly T[]): T[] {
  return links.filter((link) => !aiPairExcluded(link.from, link.to));
}

export function aiAccessLabel(value: AiAccess): string {
  if (value === "full") return "Full";
  if (value === "read_only") return "Read-only";
  return "Excluded";
}
