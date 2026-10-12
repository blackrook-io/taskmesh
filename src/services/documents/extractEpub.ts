import JSZip from "jszip";
import {
  DEFAULT_EXTRACT_LIMITS,
  EMPTY_EPUB_MESSAGE,
  type ExtractLimits,
  type ExtractOutcome,
  type ExtractSpan,
} from "./extractTypes.js";

export async function extractEpub(
  bytes: Uint8Array,
  limits: ExtractLimits = DEFAULT_EXTRACT_LIMITS,
): Promise<ExtractOutcome> {
  const zip = await JSZip.loadAsync(bytes);
  const container = await zip.file("META-INF/container.xml")?.async("text");
  if (!container) {
    throw new Error("EPUB is missing META-INF/container.xml");
  }
  const opfPath = rootfilePath(container);
  if (!opfPath) throw new Error("EPUB package path is missing");
  const opf = await zip.file(opfPath)?.async("text");
  if (!opf) throw new Error("EPUB package document is missing");

  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  const manifest = readManifest(opf);
  const spine = readSpine(opf);
  const chapters = spine
    .map((idref) => manifest.get(idref))
    .filter((item): item is ManifestItem => item != null && isChapter(item));

  const spans: ExtractSpan[] = [];
  let charCount = 0;
  let truncated = chapters.length > limits.maxUnits;
  const last = Math.min(chapters.length, limits.maxUnits);

  for (let index = 0; index < last; index += 1) {
    if (charCount >= limits.maxChars) {
      truncated = true;
      break;
    }
    const item = chapters[index];
    if (!item) continue;
    const href = resolveZipPath(opfDir, item.href);
    const xhtml = await zip.file(href)?.async("text");
    if (!xhtml) continue;
    const chapter = xhtmlToText(xhtml);
    if (!chapter.text) continue;
    const room = limits.maxChars - charCount;
    const stored = chapter.text.length > room ? chapter.text.slice(0, room) : chapter.text;
    if (stored.length < chapter.text.length) truncated = true;
    const locator = index + 1;
    spans.push({
      ordinal: spans.length + 1,
      locator,
      label: chapter.title || `Chapter ${locator}`,
      text: stored,
    });
    charCount += stored.length;
    if (stored.length < chapter.text.length) break;
  }

  if (spans.length === 0) {
    return {
      status: "empty",
      spans: [],
      unitCount: chapters.length,
      charCount: 0,
      truncated: false,
      errorMessage: EMPTY_EPUB_MESSAGE,
    };
  }
  return {
    status: "ready",
    spans,
    unitCount: chapters.length,
    charCount,
    truncated,
    errorMessage: null,
  };
}

type ManifestItem = { href: string; mediaType: string; properties: string };

function rootfilePath(container: string): string | null {
  const tag = /<rootfile\b[^>]*>/i.exec(container)?.[0];
  if (!tag) return null;
  const fullPath = attr(tag, "full-path");
  return fullPath?.replace(/^\//, "") ?? null;
}

function readManifest(opf: string): Map<string, ManifestItem> {
  const manifest = new Map<string, ManifestItem>();
  for (const tag of opf.matchAll(/<item\b[^>]*>/gi)) {
    const raw = tag[0];
    const id = attr(raw, "id");
    const href = attr(raw, "href");
    if (!id || !href) continue;
    manifest.set(id, {
      href,
      mediaType: attr(raw, "media-type") ?? "",
      properties: attr(raw, "properties") ?? "",
    });
  }
  return manifest;
}

function readSpine(opf: string): string[] {
  const spine = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(opf)?.[1] ?? "";
  const ids: string[] = [];
  for (const tag of spine.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = attr(tag[0], "idref");
    if (idref) ids.push(idref);
  }
  return ids;
}

function isChapter(item: ManifestItem): boolean {
  const type = item.mediaType.toLowerCase();
  if (type.includes("dtbncx")) return false;
  if (/\bnav\b/.test(item.properties)) return false;
  return type.includes("html") || type === "" || item.href.toLowerCase().endsWith(".xhtml");
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match?.[1] ?? match?.[2] ?? null;
}

function resolveZipPath(baseDir: string, href: string): string {
  const decoded = decodeURIComponent(href.split("#")[0] ?? href);
  const parts = `${baseDir}/${decoded}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function xhtmlToText(xhtml: string): { title: string | null; text: string } {
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(xhtml)?.[1] ?? null;
  const withoutHead = xhtml.replace(/<head\b[\s\S]*?<\/head>/gi, " ");
  const headingTag = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(withoutHead)?.[1] ?? null;
  const withoutHeading = withoutHead.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, " ");
  const stripped = withoutHeading
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(stripped).replace(/\s+/g, " ").trim();
  const titleSource = headingTag ?? titleTag ?? "";
  const title = decodeEntities(titleSource.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return { title: title || null, text };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
