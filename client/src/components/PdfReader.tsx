import { useEffect, useRef, useState } from "react";
import {
  faChevronLeft,
  faChevronRight,
  faMinus,
  faMoon,
  faPlus,
  faSun,
} from "@fortawesome/free-solid-svg-icons";
import { getDocument, GlobalWorkerOptions, PasswordResponses, RenderingCancelledException, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { NavIcon } from "./shell/NavIcon";

GlobalWorkerOptions.workerSrc = pdfWorker;

function isRenderCancelled(err: unknown): boolean {
  return (
    err instanceof RenderingCancelledException ||
    (err instanceof Error && err.name === "RenderingCancelledException")
  );
}

function isPasswordError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "PasswordException") ||
    (typeof err === "object" &&
      err != null &&
      "name" in err &&
      (err as { name?: string }).name === "PasswordException")
  );
}

type Props = {
  /** Authenticated same-origin file URL (`/api/v1/files/...`). */
  fileUrl: string;
  title?: string;
};

export type PdfReadingMode = "light" | "dark";

const READING_MODE_KEY = "taskmesh.pdfReadingMode";
const MIN_ZOOM = 50;
const MAX_ZOOM = 250;
const ZOOM_STEP = 10;

function readStoredReadingMode(): PdfReadingMode {
  try {
    const v = localStorage.getItem(READING_MODE_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    /* ignore */
  }
  return "light";
}

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(res.status === 404 ? "PDF file not found" : `Failed to load PDF (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export function PdfReader({ fileUrl, title }: Props) {
  return <PdfReaderInner key={fileUrl} fileUrl={fileUrl} title={title} />;
}

function PdfReaderInner({ fileUrl, title }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const passwordUpdateRef = useRef<((password: string) => void) | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const renderGen = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [layoutTick, setLayoutTick] = useState(0);
  const [readingMode, setReadingMode] = useState<PdfReadingMode>(() => readStoredReadingMode());
  const [passwordReason, setPasswordReason] = useState<"need" | "incorrect" | null>(null);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(READING_MODE_KEY, readingMode);
    } catch {
      /* ignore */
    }
  }, [readingMode]);

  useEffect(() => {
    if (passwordReason) passwordInputRef.current?.focus();
  }, [passwordReason]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setLayoutTick((n) => n + 1), 80);
    });
    ro.observe(wrap);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await fetchPdfBytes(fileUrl);
        if (cancelled) return;

        const loadingTask = getDocument({ data, useSystemFonts: true });
        loadingTaskRef.current = loadingTask;
        loadingTask.onPassword = (updateCallback: (password: string) => void, reason: number) => {
          if (cancelled) return;
          passwordUpdateRef.current = updateCallback;
          setPasswordBusy(false);
          setLoading(false);
          setPasswordDraft("");
          setPasswordReason(
            reason === PasswordResponses.INCORRECT_PASSWORD ? "incorrect" : "need",
          );
        };

        const pdf = await loadingTask.promise;
        if (cancelled) {
          await pdf.destroy();
          return;
        }
        loadingTaskRef.current = null;
        passwordUpdateRef.current = null;
        setPasswordReason(null);
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        loadingTaskRef.current = null;
        passwordUpdateRef.current = null;
        setPasswordReason(null);
        if (isPasswordError(err)) {
          setError("Password required to view this PDF");
        } else {
          setError(err instanceof Error ? err.message : "Failed to open PDF");
        }
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      passwordUpdateRef.current = null;
      const loadingTask = loadingTaskRef.current;
      loadingTaskRef.current = null;
      if (loadingTask) void loadingTask.destroy();
      const task = renderTaskRef.current;
      renderTaskRef.current = null;
      if (task) {
        try {
          task.cancel();
        } catch {
          /* ignore */
        }
      }
      const pdf = pdfRef.current;
      pdfRef.current = null;
      if (pdf) void pdf.destroy();
    };
  }, [fileUrl]);

  const submitPassword = () => {
    const update = passwordUpdateRef.current;
    if (!update || passwordBusy) return;
    setPasswordBusy(true);
    setLoading(true);
    setError(null);
    update(passwordDraft);
  };

  const cancelPassword = () => {
    passwordUpdateRef.current = null;
    setPasswordReason(null);
    setPasswordDraft("");
    setPasswordBusy(false);
    const loadingTask = loadingTaskRef.current;
    loadingTaskRef.current = null;
    if (loadingTask) void loadingTask.destroy();
    setLoading(false);
    setError("Password required to view this PDF");
  };

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || pageCount < 1 || loading) return;

    const gen = ++renderGen.current;
    let cancelled = false;

    const cancelActive = () => {
      const task = renderTaskRef.current;
      renderTaskRef.current = null;
      if (task) {
        try {
          task.cancel();
        } catch {
          /* ignore */
        }
      }
    };

    cancelActive();

    void (async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        if (cancelled || gen !== renderGen.current) return;

        const wrap = wrapRef.current;
        const base = pdfPage.getViewport({ scale: 1 });
        const fitWidth = wrap ? Math.max(280, wrap.clientWidth - 24) : base.width;
        const fitScale = fitWidth / base.width;
        const scale = fitScale * (zoom / 100);
        const viewport = pdfPage.getViewport({ scale });

        const outputScale = window.devicePixelRatio || 1;
        const cssW = Math.floor(viewport.width);
        const cssH = Math.floor(viewport.height);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;

        const task = pdfPage.render({
          canvas,
          viewport,
          ...(transform ? { transform } : {}),
        });
        renderTaskRef.current = task;
        try {
          await task.promise;
        } finally {
          if (renderTaskRef.current === task) renderTaskRef.current = null;
        }
        if (cancelled || gen !== renderGen.current) return;
        setError(null);
      } catch (err) {
        if (cancelled || gen !== renderGen.current || isRenderCancelled(err)) return;
        setError(err instanceof Error ? err.message : "Failed to render page");
      }
    })();

    return () => {
      cancelled = true;
      cancelActive();
    };
  }, [page, zoom, pageCount, loading, layoutTick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setPage((p) => Math.max(1, p - 1));
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        setPage((p) => Math.min(pageCount || p, p + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageCount]);

  return (
    <div className={`pdf-reader${readingMode === "dark" ? " pdf-reader--dark" : ""}`}>
      <div className="pdf-reader__toolbar">
        <button
          type="button"
          className="btn small btn-icon"
          aria-label="Previous page"
          disabled={loading || page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <NavIcon icon={faChevronLeft} />
        </button>
        <button
          type="button"
          className="btn small btn-icon"
          aria-label="Next page"
          disabled={loading || page >= pageCount}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
        >
          <NavIcon icon={faChevronRight} />
        </button>
        <span className="pdf-reader__page muted small">
          {pageCount > 0 ? `${page} / ${pageCount}` : "—"}
        </span>
        {title ? <span className="pdf-reader__title muted small">{title}</span> : null}
        <div className="pdf-reader__toolbar-end">
          <button
            type="button"
            className="btn small ghost"
            aria-label={readingMode === "dark" ? "Light page" : "Dark page"}
            title={readingMode === "dark" ? "Light page" : "Dark page"}
            onClick={() => setReadingMode((m) => (m === "dark" ? "light" : "dark"))}
          >
            <NavIcon icon={readingMode === "dark" ? faSun : faMoon} />{" "}
            {readingMode === "dark" ? "Light page" : "Dark page"}
          </button>
          <span className="pdf-reader__zoom">
            <button
              type="button"
              className="btn small btn-icon"
              aria-label="Zoom out"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
            >
              <NavIcon icon={faMinus} />
            </button>
            <span className="muted small">{zoom}%</span>
            <button
              type="button"
              className="btn small btn-icon"
              aria-label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
            >
              <NavIcon icon={faPlus} />
            </button>
          </span>
        </div>
      </div>
      <div ref={wrapRef} className="pdf-reader__viewport-wrap">
        {passwordReason ? (
          <form
            className="pdf-reader__password"
            onSubmit={(e) => {
              e.preventDefault();
              submitPassword();
            }}
          >
            <h3 className="pdf-reader__password-title">Password required</h3>
            <p className="muted small">
              {passwordReason === "incorrect"
                ? "That password was incorrect. Try again."
                : "This PDF is encrypted. Enter the password to view it."}
            </p>
            <label className="pdf-reader__password-label" htmlFor="pdf-reader-password">
              Password
            </label>
            <input
              ref={passwordInputRef}
              id="pdf-reader-password"
              type="password"
              autoComplete="off"
              value={passwordDraft}
              disabled={passwordBusy}
              onChange={(e) => setPasswordDraft(e.target.value)}
            />
            <div className="pdf-reader__password-actions">
              <button type="button" className="btn ghost small" disabled={passwordBusy} onClick={cancelPassword}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn primary small"
                disabled={passwordBusy || !passwordDraft}
              >
                {passwordBusy ? "Unlocking…" : "Unlock"}
              </button>
            </div>
          </form>
        ) : null}
        {loading && !passwordReason ? <p className="muted pdf-reader__status">Loading PDF…</p> : null}
        {error && !passwordReason ? (
          <p className="pdf-reader__status" role="alert">
            {error}
          </p>
        ) : null}
        <canvas
          ref={canvasRef}
          className="pdf-reader__canvas"
          hidden={passwordReason != null || (loading && pageCount < 1)}
        />
      </div>
    </div>
  );
}
