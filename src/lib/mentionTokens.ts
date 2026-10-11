import { entityTypeFromPrefix } from "./entityRef.js";
import type { EntityType } from "./entityType.js";

export type MentionToken = {
  entityType: EntityType;
  number: number;
};

/** Drop fenced and inline code so a mention inside it is not a link. */
export function stripMarkdownCode(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const marker = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      out.push("");
      if (marker && marker[1] === fence) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1] ?? null;
      out.push("");
      continue;
    }
    out.push(line.replace(/`[^`]*`/g, " "));
  }
  return out.join("\n");
}

function remember(
  found: MentionToken[],
  seen: Set<string>,
  letter: string,
  digits: string,
): void {
  const entityType = entityTypeFromPrefix(letter);
  if (!entityType) return;
  const number = Number(digits);
  if (!Number.isSafeInteger(number) || number < 1) return;
  const key = `${entityType}:${number}`;
  if (seen.has(key)) return;
  seen.add(key);
  found.push({ entityType, number });
}

/** `#T31`, `#T0031`, and the editor label `[T0031]`. A bare `T0031` is not a mention. */
export function extractMentionTokens(markdown: string): MentionToken[] {
  const text = stripMarkdownCode(markdown);
  const found: MentionToken[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/#([A-Za-z])(\d+)/g)) {
    remember(found, seen, match[1] ?? "", match[2] ?? "");
  }
  for (const match of text.matchAll(/\[([A-Za-z])(\d+)\]/g)) {
    remember(found, seen, match[1] ?? "", match[2] ?? "");
  }
  return found;
}
