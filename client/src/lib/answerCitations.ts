import { entityTypeFromPrefix, formatEntityRef } from "./entityRef";
import type { EntityType } from "./entityType";

const CITE_SOURCE = String.raw`(?<![A-Za-z0-9])([A-Za-z])(\d{1,6})(?!\d)(?:[\s,(]+p\.\s*(\d+)\)?)?`;

export type CitationTarget = {
  ref: string;
  page: number | null;
  entityType: EntityType;
  entityId: number;
  /** Destination for this citation, including a PDF page when `page` is set. */
  href: string;
};

export function citationRecordPath(
  projectId: number,
  citation: Pick<CitationTarget, "entityType" | "entityId" | "page">,
  options?: { todoListId?: number | null },
): string {
  const id = citation.entityId;
  switch (citation.entityType) {
    case "idea":
      return `/ideas/${id}`;
    case "project":
      return `/projects/${id}`;
    case "image_board":
      return `/image-board/${id}`;
    case "task":
      return projectQuery(projectId, { tab: "tasks", open: id });
    case "document": {
      const params: Record<string, string | number> = { tab: "documents", doc: id };
      if (citation.page != null && citation.page >= 1) params.page = citation.page;
      return projectQuery(projectId, params);
    }
    case "wiki_node":
      return projectQuery(projectId, { tab: "wiki", node: id });
    case "board":
      return projectQuery(projectId, { tab: "boards", board: id });
    case "canvas":
      return projectQuery(projectId, { tab: "canvases", canvas: id });
    case "todo_list":
      return projectQuery(projectId, { tab: "todo_lists", list: id });
    case "todo": {
      const params: Record<string, string | number> = { tab: "todo_lists" };
      if (options?.todoListId != null) {
        params.list = options.todoListId;
        params.todo = id;
      }
      return projectQuery(projectId, params);
    }
    default:
      return `/projects/${projectId}`;
  }
}

/** Turn cited display numbers into Markdown links. Uncited numbers stay plain text. */
export function linkCitedRefs(markdown: string, citations: readonly CitationTarget[]): string {
  const byRef = new Map<string, CitationTarget>();
  for (const citation of citations) {
    if (!byRef.has(citation.ref)) byRef.set(citation.ref, citation);
  }
  if (byRef.size === 0) return markdown;

  const blocked = protectedRanges(markdown);
  const pattern = new RegExp(CITE_SOURCE, "gi");
  const hits: { start: number; end: number; replacement: string }[] = [];
  for (const match of markdown.matchAll(pattern)) {
    const start = match.index;
    if (start == null || rangeOverlaps(start, blocked)) continue;
    const ref = canonicalRef(match[1] ?? "", match[2] ?? "");
    const citation = ref ? byRef.get(ref) : undefined;
    if (!citation) continue;
    const rawPage = match[3] != null ? Number(match[3]) : null;
    const pageMatches = rawPage != null && citation.page === rawPage;
    const token = `${match[1] ?? ""}${match[2] ?? ""}`;
    const label = pageMatches ? match[0] : token;
    const href = pageMatches ? citation.href : withoutPage(citation.href);
    const end = pageMatches ? start + match[0].length : start + token.length;
    hits.push({ start, end, replacement: `[${label}](${href})` });
  }

  let next = markdown;
  for (const hit of hits.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, hit.start) + hit.replacement + next.slice(hit.end);
  }
  return next;
}

function canonicalRef(letter: string, digits: string): string | null {
  const entityType = entityTypeFromPrefix(letter);
  const number = Number(digits);
  if (!entityType || !Number.isInteger(number)) return null;
  return formatEntityRef(entityType, number);
}

function projectQuery(projectId: number, params: Record<string, string | number>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  return `/projects/${projectId}?${query.toString()}`;
}

function withoutPage(href: string): string {
  const query = href.indexOf("?");
  if (query < 0) return href;
  const params = new URLSearchParams(href.slice(query + 1));
  params.delete("page");
  const rest = params.toString();
  return rest ? `${href.slice(0, query)}?${rest}` : href.slice(0, query);
}

function protectedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("```", index)) {
      const close = text.indexOf("```", index + 3);
      const end = close === -1 ? text.length : close + 3;
      ranges.push([index, end]);
      index = end;
      continue;
    }
    if (text[index] === "`") {
      const close = text.indexOf("`", index + 1);
      if (close !== -1 && !text.slice(index + 1, close).includes("\n")) {
        ranges.push([index, close + 1]);
        index = close + 1;
        continue;
      }
    }
    if (text[index] === "[") {
      const labelEnd = text.indexOf("]", index + 1);
      if (labelEnd !== -1 && text[labelEnd + 1] === "(") {
        const hrefEnd = text.indexOf(")", labelEnd + 2);
        if (hrefEnd !== -1) {
          ranges.push([index, hrefEnd + 1]);
          index = hrefEnd + 1;
          continue;
        }
      }
    }
    index += 1;
  }
  return ranges;
}

function rangeOverlaps(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}
