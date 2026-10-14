import type { AssembledContext } from "../contextAssembly.js";
import { formatEntityRef, parseEntityRefToken } from "../../../lib/entityRef.js";
import type { EntityType } from "../../../lib/entityType.js";

const CITABLE_SECTIONS = new Set(["focus", "parent", "link", "activity", "search"]);

const CITE_SOURCE = String.raw`(?<![A-Za-z0-9])([A-Za-z])(\d{1,6})(?!\d)(?:[\s,(]+p\.\s*(\d+)\)?)?`;
const LABEL_SOURCE = String.raw`\[([A-Za-z]\d{1,6})(?:\s+p\.(\d+))?\]`;

export type AnswerCitation = {
  ref: string;
  page: number | null;
  entityType: EntityType;
  entityId: number;
};

export type ResolvedRef = {
  entityType: EntityType;
  entityId: number;
};

export function canonicalRef(raw: string): string | null {
  const parsed = parseEntityRefToken(raw.trim());
  if (!parsed.entityType || parsed.number == null) return null;
  return formatEntityRef(parsed.entityType, parsed.number);
}

export type CitableRef = {
  ref: string;
  pages: number[];
};

/** Included focus, parent, link, activity, and search items. Instructions are omitted. */
export function citableRefs(packet: Pick<AssembledContext, "items" | "text">): CitableRef[] {
  const pagesByRef = new Map<string, Set<number>>();
  for (const match of packet.text.matchAll(new RegExp(LABEL_SOURCE, "g"))) {
    const ref = canonicalRef(match[1] ?? "");
    const page = match[2] != null ? Number(match[2]) : null;
    if (!ref || page == null || !Number.isInteger(page)) continue;
    const pages = pagesByRef.get(ref) ?? new Set<number>();
    pages.add(page);
    pagesByRef.set(ref, pages);
  }

  const seen = new Set<string>();
  const refs: CitableRef[] = [];
  for (const item of packet.items) {
    if (!item.ref || !CITABLE_SECTIONS.has(item.section)) continue;
    const ref = canonicalRef(item.ref);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    const pages = [...(pagesByRef.get(ref) ?? [])].sort((a, b) => a - b);
    refs.push({ ref, pages });
  }
  return refs;
}

/**
 * Citations in first-seen order. A ref must be in the included set.
 * A page is kept only when that ref’s included text carried it.
 * The answer prose is not changed here.
 */
export function citationsInAnswer(
  answer: string,
  allowed: readonly CitableRef[],
  resolved: ReadonlyMap<string, ResolvedRef>,
): AnswerCitation[] {
  const byRef = new Map(allowed.map((item) => [item.ref, new Set(item.pages)]));
  const order: string[] = [];
  const pageByRef = new Map<string, number | null>();
  for (const match of answer.matchAll(new RegExp(CITE_SOURCE, "gi"))) {
    const ref = canonicalRef(`${match[1] ?? ""}${match[2] ?? ""}`);
    if (!ref || !byRef.has(ref)) continue;
    const rawPage = match[3] != null ? Number(match[3]) : null;
    const page = rawPage != null && byRef.get(ref)?.has(rawPage) ? rawPage : null;
    if (!pageByRef.has(ref)) {
      order.push(ref);
      pageByRef.set(ref, page);
      continue;
    }
    if (pageByRef.get(ref) == null && page != null) pageByRef.set(ref, page);
  }

  const citations: AnswerCitation[] = [];
  for (const ref of order) {
    const row = resolved.get(ref);
    if (!row) continue;
    citations.push({
      ref,
      page: pageByRef.get(ref) ?? null,
      entityType: row.entityType,
      entityId: row.entityId,
    });
  }
  return citations;
}
