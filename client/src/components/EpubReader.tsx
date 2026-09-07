import { useEffect, useRef, useState } from "react";
import { faChevronLeft, faChevronRight, faListUl, faMoon, faSun } from "@fortawesome/free-solid-svg-icons";
import ePub, { type Book, type NavItem, type Rendition } from "epubjs";
import type Contents from "epubjs/types/contents";
import type Section from "epubjs/types/section";
import { NavIcon } from "./shell/NavIcon";

type Props = {
  /** Authenticated same-origin file URL (`/api/v1/files/...`). */
  fileUrl: string;
  title?: string;
};

export type EpubReadingMode = "light" | "dark";

const READING_MODE_KEY = "taskmesh.epubReadingMode";

/** Light-blue links on dark paper (readable across app themes). */
const DARK_LINK = "#8ec7ff";
const READER_THEME = "taskmesh-reader";

function readStoredReadingMode(): EpubReadingMode {
  try {
    const v = localStorage.getItem(READING_MODE_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    /* ignore */
  }
  return "light";
}

function themeVars(): { bg: string; text: string } {
  const s = getComputedStyle(document.documentElement);
  return {
    bg: s.getPropertyValue("--canvas-bg").trim() || s.getPropertyValue("--bg").trim() || "#12131a",
    text: s.getPropertyValue("--text").trim() || "#d1d3db",
  };
}

/** Serialized CSS so epub.js replaces the same stylesheet node (rules-object themes accumulate). */
function readerThemeCss(mode: EpubReadingMode): string {
  if (mode === "dark") {
    const { bg, text } = themeVars();
    return `
html, body {
  background: ${bg} !important;
  color: ${text} !important;
  margin: 0 !important;
  padding: 1em 1.25em !important;
}
body, p, div, span, li, td, th, h1, h2, h3, h4, h5, h6 {
  color: ${text} !important;
}
a { color: ${DARK_LINK} !important; }
img { max-width: 100% !important; height: auto !important; }
`.trim();
  }
  return `
html, body {
  background: #f4f1ea !important;
  color: #1a1a1a !important;
  margin: 0 !important;
  padding: 1em 1.25em !important;
}
body, p, div, span, li, td, th, h1, h2, h3, h4, h5, h6 {
  color: #1a1a1a !important;
}
a { color: #0b5fff !important; }
img { max-width: 100% !important; height: auto !important; }
`.trim();
}

function applyReadingTheme(rendition: Rendition, mode: EpubReadingMode): void {
  const css = readerThemeCss(mode);
  // Same theme id + registerCss → stylesheet innerHTML is replaced (unlike registerRules).
  rendition.themes.registerCss(READER_THEME, css);
  rendition.themes.select(READER_THEME);
  // epub.js inject() only auto-applies themes with `rules` or `url` — serialized CSS is
  // skipped on newly opened sections (Contents / next-chapter). Force into every view.
  // Runtime returns Contents[]; typings incorrectly say a single Contents.
  const contents = rendition.getContents() as unknown as Contents[];
  const list = Array.isArray(contents) ? contents : contents ? [contents] : [];
  for (const content of list) {
    void content.addStylesheetCss(css, READER_THEME);
    content.addClass(READER_THEME);
  }
}

async function fetchEpubArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(res.status === 404 ? "EPUB file not found" : `Failed to load EPUB (${res.status})`);
  }
  return res.arrayBuffer();
}

function flattenToc(items: NavItem[]): NavItem[] {
  const out: NavItem[] = [];
  for (const item of items) {
    out.push(item);
    if (item.subitems?.length) out.push(...flattenToc(item.subitems));
  }
  return out;
}

function measureHost(el: HTMLElement): { width: number; height: number } {
  const rect = el.getBoundingClientRect();
  return {
    width: Math.max(320, Math.floor(el.clientWidth || rect.width || 320)),
    height: Math.max(360, Math.floor(el.clientHeight || rect.height || 480)),
  };
}

export function EpubReader({ fileUrl, title }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const readingModeRef = useRef<EpubReadingMode>(readStoredReadingMode());
  const fontScaleRef = useRef(100);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [fontScale, setFontScale] = useState(100);
  const [tocOpen, setTocOpen] = useState(false);
  const [readingMode, setReadingMode] = useState<EpubReadingMode>(() => readStoredReadingMode());

  useEffect(() => {
    readingModeRef.current = readingMode;
    try {
      localStorage.setItem(READING_MODE_KEY, readingMode);
    } catch {
      /* ignore */
    }
  }, [readingMode]);

  useEffect(() => {
    fontScaleRef.current = fontScale;
  }, [fontScale]);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    setLoading(true);
    setError(null);
    setToc([]);

    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      try {
        const buf = await fetchEpubArrayBuffer(fileUrl);
        if (cancelled) return;

        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        if (cancelled) return;

        const book = ePub(buf);
        bookRef.current = book;
        const { width, height } = measureHost(host);

        const rendition = book.renderTo(host, {
          width,
          height,
          flow: "paginated",
          spread: "none",
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;
        applyReadingTheme(rendition, readingModeRef.current);
        // Re-apply after every section render (TOC / prev / next load new iframes).
        const onRendered = () => {
          if (cancelled) return;
          applyReadingTheme(rendition, readingModeRef.current);
          rendition.themes.fontSize(`${fontScaleRef.current}%`);
        };
        rendition.on("rendered", onRendered);
        rendition.hooks.content.register((contents: Contents) => {
          void contents.addStylesheetCss(readerThemeCss(readingModeRef.current), READER_THEME);
          contents.addClass(READER_THEME);
        });

        await book.ready;
        if (cancelled) return;
        setToc(book.navigation?.toc ?? []);
        await rendition.display();
        if (cancelled) return;

        const again = measureHost(host);
        rendition.resize(again.width, again.height);
        rendition.themes.fontSize(`${fontScale}%`);
        applyReadingTheme(rendition, readingModeRef.current);
        setLoading(false);

        resizeObserver = new ResizeObserver(() => {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            const el = hostRef.current;
            const r = renditionRef.current;
            if (!el || !r) return;
            const size = measureHost(el);
            r.resize(size.width, size.height);
          }, 50);
        });
        resizeObserver.observe(host);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to open EPUB");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      try {
        const r = renditionRef.current;
        if (r) {
          // Handler identity not retained here; destroy clears listeners.
          r.destroy();
        }
      } catch {
        /* ignore */
      }
      try {
        bookRef.current?.destroy();
      } catch {
        /* ignore */
      }
      renditionRef.current = null;
      bookRef.current = null;
      host.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when file changes
  }, [fileUrl]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || loading) return;
    rendition.themes.fontSize(`${fontScale}%`);
  }, [fontScale, loading]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || loading) return;
    applyReadingTheme(rendition, readingMode);
    // Keep font size after theme swap (select can reset overrides).
    rendition.themes.fontSize(`${fontScale}%`);
  }, [readingMode, loading, fontScale]);

  useEffect(() => {
    if (loading) return;
    const el = hostRef.current;
    const r = renditionRef.current;
    if (!el || !r) return;
    const t = window.setTimeout(() => {
      const size = measureHost(el);
      r.resize(size.width, size.height);
    }, 80);
    return () => window.clearTimeout(t);
  }, [tocOpen, loading]);

  const goPrev = () => {
    void renditionRef.current?.prev();
  };
  const goNext = () => {
    void renditionRef.current?.next();
  };

  const goToHref = (href: string) => {
    const book = bookRef.current;
    const r = renditionRef.current;
    if (!r || !book || !href) return;

    const raw = href.trim();
    const hashIdx = raw.indexOf("#");
    const pathPart = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw).replace(/^\.\//, "");
    const hash = hashIdx >= 0 ? raw.slice(hashIdx) : "";
    const baseName = pathPart.split("/").pop() || pathPart;

    const withHash = (spineHref: string) => (hash ? `${spineHref}${hash}` : spineHref);

    const candidates: string[] = [];
    const push = (v: string | null | undefined) => {
      if (v && !candidates.includes(v)) candidates.push(v);
    };

    push(raw);
    const direct = book.spine.get(raw) || book.spine.get(pathPart);
    if (direct?.href) push(withHash(direct.href));

    book.spine.each((section: Section) => {
      const sh = section.href || "";
      const sb = sh.split("/").pop() || sh;
      if (
        sb === baseName ||
        decodeURIComponent(sb) === decodeURIComponent(baseName) ||
        sh === pathPart ||
        sh.endsWith(`/${pathPart}`)
      ) {
        push(withHash(sh));
      }
    });

    void (async () => {
      let lastErr: unknown;
      for (const target of candidates) {
        try {
          await r.display(target);
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) {
        console.warn("EPUB Contents navigation failed", raw, candidates, lastErr);
      }
    })();
  };

  return (
    <div className={`epub-reader${readingMode === "dark" ? " epub-reader--dark" : ""}`}>
      <div className="epub-reader__toolbar">
        <button
          type="button"
          className="btn small btn-icon"
          onClick={() => setTocOpen((o) => !o)}
          disabled={loading || !!error}
          aria-pressed={tocOpen}
          aria-label={tocOpen ? "Hide contents" : "Show contents"}
          title={tocOpen ? "Hide contents" : "Contents"}
        >
          <NavIcon icon={faListUl} size={14} />
        </button>
        <button
          type="button"
          className="btn small btn-icon"
          onClick={goPrev}
          disabled={loading || !!error}
          aria-label="Previous page"
          title="Previous"
        >
          <NavIcon icon={faChevronLeft} size={14} />
        </button>
        <button
          type="button"
          className="btn small btn-icon"
          onClick={goNext}
          disabled={loading || !!error}
          aria-label="Next page"
          title="Next"
        >
          <NavIcon icon={faChevronRight} size={14} />
        </button>
        {title ? <span className="epub-reader__title muted small">{title}</span> : null}
        <div className="epub-reader__toolbar-end">
          <button
            type="button"
            className="btn small btn-icon"
            disabled={loading || !!error}
            aria-pressed={readingMode === "dark"}
            aria-label={readingMode === "dark" ? "Switch to light reading mode" : "Switch to dark reading mode"}
            title={readingMode === "dark" ? "Light page" : "Dark page"}
            onClick={() => setReadingMode((m) => (m === "dark" ? "light" : "dark"))}
          >
            <NavIcon icon={readingMode === "dark" ? faSun : faMoon} size={14} />
          </button>
          <span className="epub-reader__font">
            <button
              type="button"
              className="btn small ghost"
              aria-label="Decrease font size"
              disabled={loading || !!error || fontScale <= 70}
              onClick={() => setFontScale((s) => Math.max(70, s - 10))}
            >
              A−
            </button>
            <span className="muted small">{fontScale}%</span>
            <button
              type="button"
              className="btn small ghost"
              aria-label="Increase font size"
              disabled={loading || !!error || fontScale >= 160}
              onClick={() => setFontScale((s) => Math.min(160, s + 10))}
            >
              A+
            </button>
          </span>
        </div>
      </div>
      <div className="epub-reader__body">
        {tocOpen ? (
          <nav className="epub-reader__toc" aria-label="EPUB table of contents">
            {toc.length === 0 ? (
              <p className="muted small">No contents listed.</p>
            ) : (
              <ul>
                {flattenToc(toc).map((item) => (
                  <li key={`${item.id ?? item.href}-${item.label}`}>
                    <button type="button" className="epub-reader__toc-link" onClick={() => goToHref(item.href)}>
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        ) : null}
        <div className="epub-reader__viewport-wrap">
          {loading ? <p className="muted epub-reader__status">Loading EPUB…</p> : null}
          {error ? (
            <p className="epub-reader__status" role="alert">
              {error}
            </p>
          ) : null}
          <div ref={hostRef} className="epub-reader__viewport" />
        </div>
      </div>
    </div>
  );
}
