import dns from "node:dns/promises";
import net from "node:net";
import { isBlockedHostname, isBlockedIp } from "../../lib/privateNet.js";

const MAX_BYTES = 500_000;
const TIMEOUT_MS = 12_000;
const MAX_TEXT = 12_000;
const MAX_REDIRECTS = 2;

export class FetchUrlBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchUrlBlockedError";
  }
}

async function assertUrlAllowed(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchUrlBlockedError("Only http and https URLs are allowed");
  }
  if (url.username || url.password) {
    throw new FetchUrlBlockedError("URLs with credentials are not allowed");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isBlockedHostname(host)) {
    throw new FetchUrlBlockedError("Fetching private or local network URLs is not allowed");
  }
  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      throw new FetchUrlBlockedError("Fetching private or local network URLs is not allowed");
    }
    return;
  }
  let records: { address: string }[];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new FetchUrlBlockedError("Could not resolve host");
  }
  if (records.length === 0) {
    throw new FetchUrlBlockedError("Could not resolve host");
  }
  for (const rec of records) {
    if (isBlockedIp(rec.address)) {
      throw new FetchUrlBlockedError("Fetching private or local network URLs is not allowed");
    }
  }
}

/**
 * Fetch a URL for assistant research. Only http(s); returns plain text excerpt.
 */
export async function fetchUrlForAssistant(
  urlStr: string,
  signal?: AbortSignal,
): Promise<{ url: string; title: string | null; text: string; truncated: boolean }> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error("Invalid URL");
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const onAbort = () => ac.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    let current = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertUrlAllowed(current);
      res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: ac.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8",
          "User-Agent": "TaskMeshAssistant/1.0 (+private research fetch)",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) {
          throw new FetchUrlBlockedError("Redirect without Location");
        }
        if (hop === MAX_REDIRECTS) {
          throw new FetchUrlBlockedError("Too many redirects");
        }
        current = new URL(loc, current);
        continue;
      }
      break;
    }
    if (!res) {
      throw new Error("Fetch failed");
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      throw new Error(`Response larger than ${MAX_BYTES} bytes`);
    }
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(buf);

    if (ctype.includes("application/json") || raw.trimStart().startsWith("{") || raw.trimStart().startsWith("[")) {
      const clipped = raw.length > MAX_TEXT ? `${raw.slice(0, MAX_TEXT)}…` : raw;
      return {
        url: current.toString(),
        title: null,
        text: clipped,
        truncated: raw.length > MAX_TEXT,
      };
    }

    const { title, text, truncated } = htmlToText(raw);
    return { url: current.toString(), title, text, truncated };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Fetch timed out or was cancelled");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function htmlToText(html: string): { title: string | null; text: string; truncated: boolean } {
  let s = html;
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s);
  const title = titleMatch?.[1] ? decodeEntities(stripTags(titleMatch[1])).trim() || null : null;

  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = stripTags(s);
  s = decodeEntities(s);
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

  const truncated = s.length > MAX_TEXT;
  if (truncated) s = `${s.slice(0, MAX_TEXT)}…`;
  return { title, text: s, truncated };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
