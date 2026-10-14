import { clampConfidence, type ModelScore } from "./decide.js";

/** Parse a model JSON array. Invalid output is null, not a guessed score list. */
export function parseModelScores(text: string): ModelScore[] | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const scores: ModelScore[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") return null;
    const name = "name" in row && typeof row.name === "string" ? row.name.trim() : "";
    const confidence = "confidence" in row ? row.confidence : null;
    if (!name || typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
    scores.push({ name: name.slice(0, 100), confidence: clampConfidence(confidence) });
  }
  return scores;
}
