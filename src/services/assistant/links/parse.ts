export type ModelLinkScore = {
  key: string;
  match: number;
  reason: string;
};

const KEY = /^[a-z_]+:[1-9][0-9]*$/;

/** Parse `{ items: [{ key, match, reason }] }`. Invalid output is null. */
export function parseLinkScores(text: string): ModelLinkScore[] | null {
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
  if (!parsed || typeof parsed !== "object" || !("items" in parsed) || !Array.isArray(parsed.items)) {
    return null;
  }
  const scores: ModelLinkScore[] = [];
  for (const item of parsed.items) {
    if (!item || typeof item !== "object") continue;
    const key = "key" in item ? item.key : null;
    const match = "match" in item ? item.match : null;
    const reason = "reason" in item ? item.reason : "";
    if (typeof key !== "string" || !KEY.test(key)) continue;
    if (typeof match !== "number" || !Number.isFinite(match)) continue;
    scores.push({
      key,
      match,
      reason: typeof reason === "string" ? reason : "",
    });
  }
  return scores;
}
