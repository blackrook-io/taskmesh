/** Show a suggestion at or above this confidence. */
export const SHOW_AT = 0.45;
/** Auto-apply an existing or allowed new tag at or above this confidence. */
export const APPLY_AT = 0.75;
/** Index-only confidence never reaches auto-apply. */
export const INDEX_CAP = 0.7;
export const MAX_SURFACED = 5;
export const MAX_CANDIDATES = 30;

export type NeighborCandidate = {
  tagId: number;
  name: string;
  count: number;
};

export type ModelScore = {
  name: string;
  confidence: number;
};

export type PlannedTag = {
  name: string;
  tagId: number | null;
  confidence: number;
  invented: boolean;
};

export type TaggingSkip = "unchanged" | "excluded" | "off" | "empty";

export type TaggingPlan = {
  skip: TaggingSkip | null;
  apply: PlannedTag[];
  suggest: PlannedTag[];
};

export function indexConfidence(count: number, neighbors: number): number {
  if (count <= 0 || neighbors <= 0) return 0;
  return Math.min(INDEX_CAP, count / neighbors);
}

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function norm(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Turn neighbor counts and an optional model score list into apply vs suggest.
 * A missing model (`modelScores === null`) never auto-applies.
 * Unknown names are dropped unless `allowInventTags` is set.
 */
export function planTaggingRun(args: {
  contentHash: string;
  previousHash: string | null;
  access: "full" | "read_only" | "excluded" | null;
  featureOff: boolean;
  allowInventTags: boolean;
  canAutoApply: boolean;
  candidates: NeighborCandidate[];
  neighborCount: number;
  alreadyNames: string[];
  modelScores: ModelScore[] | null;
  remainingSlots: number;
}): TaggingPlan {
  const empty: TaggingPlan = { skip: "empty", apply: [], suggest: [] };
  if (args.featureOff) return { skip: "off", apply: [], suggest: [] };
  if (args.access === "excluded") return { skip: "excluded", apply: [], suggest: [] };
  if (args.previousHash != null && args.previousHash === args.contentHash) {
    return { skip: "unchanged", apply: [], suggest: [] };
  }
  if (args.remainingSlots <= 0) return empty;

  const already = new Set(args.alreadyNames.map(norm).filter((name) => name.length > 0));
  const known = new Map<string, { id: number; name: string }>();
  for (const candidate of args.candidates) {
    const key = norm(candidate.name);
    if (!key || known.has(key)) continue;
    known.set(key, { id: candidate.tagId, name: candidate.name.trim() });
  }

  const scored = new Map<string, PlannedTag>();
  if (args.modelScores == null) {
    for (const candidate of args.candidates) {
      const key = norm(candidate.name);
      if (!key || already.has(key) || scored.has(key)) continue;
      const knownTag = known.get(key);
      if (!knownTag) continue;
      scored.set(key, {
        name: knownTag.name,
        tagId: knownTag.id,
        confidence: indexConfidence(candidate.count, args.neighborCount),
        invented: false,
      });
    }
  } else {
    for (const row of args.modelScores) {
      const key = norm(row.name);
      if (!key || already.has(key)) continue;
      const knownTag = known.get(key);
      const confidence = clampConfidence(row.confidence);
      if (knownTag) {
        const previous = scored.get(key);
        if (previous && previous.confidence >= confidence) continue;
        scored.set(key, {
          name: knownTag.name,
          tagId: knownTag.id,
          confidence,
          invented: false,
        });
        continue;
      }
      if (!args.allowInventTags) continue;
      const name = row.name.trim().slice(0, 100);
      if (!name) continue;
      const previous = scored.get(key);
      if (previous && previous.confidence >= confidence) continue;
      scored.set(key, { name, tagId: null, confidence, invented: true });
    }
  }

  const ranked = [...scored.values()]
    .filter((tag) => tag.confidence >= SHOW_AT)
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name))
    .slice(0, args.remainingSlots);
  if (ranked.length === 0) return empty;

  const auto =
    args.modelScores != null && args.canAutoApply && args.access !== "read_only";
  const apply: PlannedTag[] = [];
  const suggest: PlannedTag[] = [];
  for (const tag of ranked) {
    const mayApply = auto && tag.confidence >= APPLY_AT && (tag.tagId != null || args.allowInventTags);
    if (mayApply) apply.push(tag);
    else suggest.push(tag);
  }
  return { skip: null, apply, suggest };
}

/** One accept per auto-applied tag. Suggestions wait for a click. */
export function autoApplyAccepts(plan: TaggingPlan): number {
  return plan.apply.length;
}

export function undoFeedbackTargets(auditIds: Array<number | null | undefined>): number[] {
  const ids: number[] = [];
  for (const id of auditIds) {
    if (typeof id === "number" && Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
