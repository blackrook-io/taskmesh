import { createHash } from "node:crypto";
import type { EntityType } from "../../lib/entityType.js";
import { formatEntityRef } from "../../lib/entityRef.js";

/** Target chunk length in characters. */
export const CHUNK_TARGET = 1200;
/** Characters repeated at the start of the next piece of a long section. */
export const CHUNK_OVERLAP = 150;

export type TextChunk = {
  heading: string | null;
  startOffset: number;
  endOffset: number;
  content: string;
};

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function titleChunkText(entityType: EntityType, number: number, title: string): string {
  return `${formatEntityRef(entityType, number)} ${title}`.trim();
}

/** Split Markdown on headings, then pack long sections with a short overlap. */
export function chunkMarkdown(text: string): TextChunk[] {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [];
  const chunks: TextChunk[] = [];
  for (const section of splitHeadings(normalized)) {
    chunks.push(...splitLong(section.body, section.heading, section.start));
  }
  return chunks;
}

function splitHeadings(text: string): Array<{ heading: string | null; body: string; start: number }> {
  const matches = [...text.matchAll(/^#{1,6}[ \t]+(.+)$/gm)];
  if (matches.length === 0) return [{ heading: null, body: text, start: 0 }];
  const sections: Array<{ heading: string | null; body: string; start: number }> = [];
  const first = matches[0]?.index ?? 0;
  if (first > 0) {
    const preamble = text.slice(0, first);
    if (preamble.trim()) sections.push({ heading: null, body: preamble, start: 0 });
  }
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match || match.index == null) continue;
    const next = matches[i + 1];
    const end = next?.index ?? text.length;
    sections.push({
      heading: match[1]?.trim() || null,
      body: text.slice(match.index, end),
      start: match.index,
    });
  }
  return sections;
}

function splitLong(body: string, heading: string | null, base: number): TextChunk[] {
  if (!body.trim()) return [];
  if (body.length <= CHUNK_TARGET) {
    return [{ heading, content: body.trim(), startOffset: base, endOffset: base + body.length }];
  }
  const chunks: TextChunk[] = [];
  let cursor = 0;
  while (cursor < body.length) {
    let end = Math.min(body.length, cursor + CHUNK_TARGET);
    if (end < body.length) {
      const window = body.slice(cursor, end);
      const paragraph = window.lastIndexOf("\n\n");
      const line = window.lastIndexOf("\n");
      const breakAt = paragraph > CHUNK_TARGET * 0.5 ? paragraph : line;
      if (breakAt > CHUNK_TARGET * 0.5) end = cursor + breakAt;
    }
    const slice = body.slice(cursor, end);
    if (slice.trim()) {
      chunks.push({
        heading,
        content: slice.trim(),
        startOffset: base + cursor,
        endOffset: base + end,
      });
    }
    if (end >= body.length) break;
    const next = end - CHUNK_OVERLAP;
    cursor = next > cursor ? next : cursor + 1;
  }
  return chunks;
}
