export const DUPLICATE_ENTITY_TYPES = ["task", "todo"] as const;
export type DuplicateEntityType = (typeof DUPLICATE_ENTITY_TYPES)[number];

/** Show a hit at or above this score. */
export const SURFACE_AT = 0.72;
/** Exact and very strong hits skip the model. */
export const MODEL_BELOW = 0.92;
export const MAX_HITS = 3;

export type DuplicateEnd = {
  entityType: DuplicateEntityType;
  entityId: number;
};

export type DuplicateReason = "exact_title" | "near_title" | "index" | "model";

export type TitleCandidate = DuplicateEnd & {
  title: string;
  /** Cosine similarity, 0..1, when the index returned this record. */
  semantic: number | null;
  /** Excluded-project text must not be sent to a model. */
  modelBlocked: boolean;
};

export type PlannedDuplicate = DuplicateEnd & {
  score: number;
  reason: DuplicateReason;
  needsModel: boolean;
};

export function isDuplicateEntityType(value: string): value is DuplicateEntityType {
  return (DUPLICATE_ENTITY_TYPES as readonly string[]).includes(value);
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/ +/g, " ");
}

export function canonicalEnds(a: DuplicateEnd, b: DuplicateEnd): [DuplicateEnd, DuplicateEnd] {
  const ak = `${a.entityType}\0${String(a.entityId).padStart(10, "0")}`;
  const bk = `${b.entityType}\0${String(b.entityId).padStart(10, "0")}`;
  return ak <= bk ? [a, b] : [b, a];
}

export function pairKey(a: DuplicateEnd, b: DuplicateEnd): string {
  const [left, right] = canonicalEnds(a, b);
  return `${left.entityType}:${left.entityId}|${right.entityType}:${right.entityId}`;
}

function tokenJaccard(a: string, b: string): number {
  const left = new Set(a.split(" ").filter((token) => token.length > 0));
  const right = new Set(b.split(" ").filter((token) => token.length > 0));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function titleSignal(
  subject: string,
  candidate: string,
): { score: number; reason: "exact_title" | "near_title" } | null {
  if (subject.length < 3 || candidate.length < 3) return null;
  if (subject === candidate) return { score: 1, reason: "exact_title" };
  const jaccard = tokenJaccard(subject, candidate);
  const subjectTokens = subject.split(" ").length;
  const candidateTokens = candidate.split(" ").length;
  if (jaccard >= 0.8 && subjectTokens >= 2 && candidateTokens >= 2) {
    return { score: Math.min(1, Math.max(0.86, jaccard)), reason: "near_title" };
  }
  if (
    subject.length >= 12 &&
    candidate.length >= 12 &&
    (subject.includes(candidate) || candidate.includes(subject))
  ) {
    return { score: 0.84, reason: "near_title" };
  }
  return null;
}

/**
 * Rank visible task/todo titles against one subject.
 * Ignored, linked, and rejected pairs are dropped.
 * Only the best ambiguous hit asks for a model pass. Exact titles never do.
 */
export function planDuplicateHits(args: {
  subject: DuplicateEnd | null;
  subjectTitle: string;
  candidates: TitleCandidate[];
  suppressedKeys: ReadonlySet<string>;
  /** Subject text must not be sent to a model. */
  subjectBlocked: boolean;
}): PlannedDuplicate[] {
  const subjectNorm = normalizeTitle(args.subjectTitle);
  const hits: PlannedDuplicate[] = [];
  for (const candidate of args.candidates) {
    if (
      args.subject &&
      candidate.entityType === args.subject.entityType &&
      candidate.entityId === args.subject.entityId
    ) {
      continue;
    }
    if (args.subject && args.suppressedKeys.has(pairKey(args.subject, candidate))) continue;
    const title = titleSignal(subjectNorm, normalizeTitle(candidate.title));
    const semantic =
      candidate.semantic != null && candidate.semantic >= 0.78 ? Math.min(1, candidate.semantic) : null;
    let score = 0;
    let reason: DuplicateReason = "index";
    if (title?.reason === "exact_title") {
      score = 1;
      reason = "exact_title";
    } else if (title && (semantic == null || title.score >= semantic)) {
      score = title.score;
      reason = title.reason;
    } else if (semantic != null) {
      score = semantic;
      reason = "index";
    } else {
      continue;
    }
    if (score < SURFACE_AT) continue;
    const needsModel =
      !args.subjectBlocked &&
      !candidate.modelBlocked &&
      reason !== "exact_title" &&
      score < MODEL_BELOW;
    hits.push({
      entityType: candidate.entityType,
      entityId: candidate.entityId,
      score,
      reason,
      needsModel,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.entityType.localeCompare(b.entityType) || a.entityId - b.entityId);
  let asked = false;
  return hits.slice(0, MAX_HITS).map((hit) => {
    if (!hit.needsModel || asked) return { ...hit, needsModel: false };
    asked = true;
    return hit;
  });
}

export type ModelDuplicateAnswer = {
  duplicate: boolean;
  confidence: number;
};

/** A model “no” drops the hit. Missing or invalid JSON keeps the deterministic hit. */
export function applyModelAnswer(
  hit: PlannedDuplicate,
  answer: ModelDuplicateAnswer | null,
): PlannedDuplicate | null {
  if (!hit.needsModel) return { ...hit, needsModel: false };
  if (!answer) return { ...hit, needsModel: false };
  if (!answer.duplicate || answer.confidence < 0.5) return null;
  return {
    ...hit,
    needsModel: false,
    reason: "model",
    score: Math.min(1, Math.max(hit.score, answer.confidence)),
  };
}
