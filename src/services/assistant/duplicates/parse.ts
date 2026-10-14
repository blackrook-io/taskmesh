import type { ModelDuplicateAnswer } from "./match.js";

/** Parse `{ duplicate, confidence }`. Invalid output is null, not a guessed no. */
export function parseDuplicateAnswer(text: string): ModelDuplicateAnswer | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const duplicate = "duplicate" in parsed ? parsed.duplicate : null;
  const confidence = "confidence" in parsed ? parsed.confidence : null;
  if (typeof duplicate !== "boolean") return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  return { duplicate, confidence: Math.min(1, Math.max(0, confidence)) };
}
