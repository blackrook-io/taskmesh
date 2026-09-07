import JSZip from "jszip";

/** Fallback display title from a filename, without a trailing .epub. */
export function titleFromEpubFilename(name: string): string {
  const base = name.replace(/\.epub$/i, "").trim();
  return base || "Untitled EPUB";
}

/**
 * Read `dc:title` (or first `<title>`) from an EPUB's package document.
 * Returns null when metadata is missing or the file is not a readable EPUB.
 */
export async function extractEpubTitle(file: File | ArrayBuffer): Promise<string | null> {
  try {
    const buf = file instanceof File ? await file.arrayBuffer() : file;
    const zip = await JSZip.loadAsync(buf);
    const containerXml = await zip.file("META-INF/container.xml")?.async("text");
    if (!containerXml) return null;
    const rootMatch =
      /full-path\s*=\s*["']([^"']+)["']/i.exec(containerXml) ??
      /full-path\s*=\s*([^\s>]+)/i.exec(containerXml);
    const opfPath = rootMatch?.[1]?.replace(/^\//, "");
    if (!opfPath) return null;
    const opf = await zip.file(opfPath)?.async("text");
    if (!opf) return null;

    const dcTitle =
      /<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf) ??
      /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(opf);
    if (!dcTitle?.[1]) return null;
    const text = dcTitle[1]
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

/** Prefer package metadata title; otherwise filename without .epub. */
export async function resolveEpubDocumentTitle(file: File): Promise<string> {
  const meta = await extractEpubTitle(file);
  if (meta) return meta;
  return titleFromEpubFilename(file.name);
}
