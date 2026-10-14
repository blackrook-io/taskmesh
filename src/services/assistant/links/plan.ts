import type { EntityType } from "../../../lib/entityType.js";

export const LINK_SUBJECT_TYPES = ["task", "todo", "idea", "document"] as const;
export type LinkSubjectType = (typeof LINK_SUBJECT_TYPES)[number];

export const LINK_SIGNALS = ["shared_tags", "mention", "same_list", "same_board", "similar_text"] as const;
export type LinkSignal = (typeof LINK_SIGNALS)[number];

export const MAX_LINK_SUGGESTIONS = 8;
/** A model score under this is stored as rejected and not shown again. */
export const MODEL_REJECT_BELOW = 0.45;

const SURFACE_AT = 0.55;
const SIMILAR_AT = 0.78;

export const SIGNAL_REASON: Record<LinkSignal, string> = {
  shared_tags: "shared tags",
  mention: "mentioned by title",
  same_list: "same list",
  same_board: "same board",
  similar_text: "similar text",
};

export function isLinkSubjectType(value: string): value is LinkSubjectType {
  return (LINK_SUBJECT_TYPES as readonly string[]).includes(value);
}

export function isLinkSignal(value: string): value is LinkSignal {
  return (LINK_SIGNALS as readonly string[]).includes(value);
}

export type LinkEnd = {
  entityType: string;
  entityId: number;
};

export function unorderedPairKey(a: LinkEnd, b: LinkEnd): string {
  const left = `${a.entityType}:${String(a.entityId).padStart(10, "0")}`;
  const right = `${b.entityType}:${String(b.entityId).padStart(10, "0")}`;
  return left <= right
    ? `${a.entityType}:${a.entityId}|${b.entityType}:${b.entityId}`
    : `${b.entityType}:${b.entityId}|${a.entityType}:${a.entityId}`;
}

export type LinkCandidate = LinkEnd & {
  sharedTags: number;
  mention: boolean;
  sameList: boolean;
  sameBoard: boolean;
  /** Cosine similarity, 0..1, when the index returned this record. */
  semantic: number | null;
  /** Excluded-project text must not be sent to a model. */
  modelBlocked: boolean;
};

export type PlannedLink = LinkEnd & {
  score: number;
  reason: string;
  signal: LinkSignal;
  needsModel: boolean;
};

export function visibleCandidates(
  candidates: readonly LinkCandidate[],
  visibleKeys: ReadonlySet<string>,
): LinkCandidate[] {
  return candidates.filter((candidate) =>
    visibleKeys.has(`${candidate.entityType}:${candidate.entityId}`),
  );
}

function tagScore(count: number): number {
  if (count < 1) return 0;
  return Math.min(0.72, 0.56 + (count - 1) * 0.04);
}

function signalRank(signal: LinkSignal): number {
  if (signal === "mention") return 0;
  if (signal === "similar_text") return 1;
  if (signal === "shared_tags") return 2;
  if (signal === "same_list") return 3;
  return 4;
}

/** Drop pairs the user already settled, and keep the strongest remaining signal. */
export function planLinkSuggestions(args: {
  subject: LinkEnd;
  candidates: readonly LinkCandidate[];
  suppressedKeys: ReadonlySet<string>;
}): PlannedLink[] {
  const ranked: PlannedLink[] = [];
  for (const candidate of args.candidates) {
    if (
      candidate.entityType === args.subject.entityType &&
      candidate.entityId === args.subject.entityId
    ) {
      continue;
    }
    if (args.suppressedKeys.has(unorderedPairKey(args.subject, candidate))) continue;
    const options: Array<{ signal: LinkSignal; score: number }> = [];
    const tags = tagScore(candidate.sharedTags);
    if (tags >= SURFACE_AT) options.push({ signal: "shared_tags", score: tags });
    if (candidate.mention) options.push({ signal: "mention", score: 0.74 });
    if (candidate.sameList) options.push({ signal: "same_list", score: 0.6 });
    if (candidate.sameBoard) options.push({ signal: "same_board", score: 0.6 });
    if (candidate.semantic != null && candidate.semantic >= SIMILAR_AT) {
      options.push({ signal: "similar_text", score: Math.min(1, candidate.semantic) });
    }
    if (options.length === 0) continue;
    options.sort((a, b) => b.score - a.score || signalRank(a.signal) - signalRank(b.signal));
    const best = options[0]!;
    ranked.push({
      entityType: candidate.entityType,
      entityId: candidate.entityId,
      score: Math.round(best.score * 1000) / 1000,
      reason: SIGNAL_REASON[best.signal],
      signal: best.signal,
      needsModel: !candidate.modelBlocked,
    });
  }
  ranked.sort(
    (a, b) => b.score - a.score || a.entityType.localeCompare(b.entityType) || a.entityId - b.entityId,
  );
  return ranked.slice(0, MAX_LINK_SUGGESTIONS);
}

export function clampReason(reason: string, fallback: string): string {
  const cleaned = reason.trim().replace(/\s+/g, " ").slice(0, 160);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Model "no" becomes rejected. A missing answer keeps the heuristic. */
export function applyModelScore(
  planned: PlannedLink,
  answer: { match: number; reason: string } | null,
): { status: "pending" | "rejected"; score: number; reason: string } {
  if (!answer) return { status: "pending", score: planned.score, reason: planned.reason };
  const match = answer.match > 1 && answer.match <= 100 ? answer.match / 100 : answer.match;
  const score = Math.min(1, Math.max(0, match));
  const reason = clampReason(answer.reason, planned.reason);
  if (score < MODEL_REJECT_BELOW) return { status: "rejected", score, reason };
  return { status: "pending", score, reason };
}

/** Accept always creates this manual references link, source to target. */
export function referencesLinkEnds(suggestion: {
  srcType: EntityType;
  srcId: number;
  dstType: EntityType;
  dstId: number;
}): {
  srcType: EntityType;
  srcId: number;
  dstType: EntityType;
  dstId: number;
  relation: "references";
} {
  return {
    srcType: suggestion.srcType,
    srcId: suggestion.srcId,
    dstType: suggestion.dstType,
    dstId: suggestion.dstId,
    relation: "references",
  };
}
