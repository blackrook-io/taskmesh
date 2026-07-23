import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

const FALLBACK_COL = 280;
const FALLBACK_GAP = 12;
const PEEK = 28;

type Props = {
  columnCount: number;
  /** Reset paging when board identity changes */
  boardKey: number | string;
  children: ReactNode;
};

export function KanbanBoardCarousel({ columnCount, boardKey, children }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [colWidth, setColWidth] = useState(FALLBACK_COL);
  const [gap, setGap] = useState(FALLBACK_GAP);
  const [page, setPage] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport) return;

    const measure = () => {
      setViewportWidth(viewport.clientWidth);
      const first = track?.querySelector(".kanban-column") as HTMLElement | null;
      if (first) {
        setColWidth(first.getBoundingClientRect().width);
        const style = getComputedStyle(track!);
        const g = Number.parseFloat(style.columnGap || style.gap || String(FALLBACK_GAP));
        if (Number.isFinite(g) && g > 0) setGap(g);
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewport);
    if (track) ro.observe(track);
    return () => ro.disconnect();
  }, [columnCount, boardKey]);

  useEffect(() => {
    setPage(0);
  }, [boardKey, columnCount]);

  const step = colWidth + gap;
  const colsPerPage = useMemo(() => {
    if (viewportWidth <= 0 || step <= 0) return 1;
    const usable = Math.max(colWidth, viewportWidth - PEEK * 2);
    return Math.max(1, Math.floor((usable + gap) / step));
  }, [viewportWidth, step, colWidth, gap]);

  const pageCount = Math.max(1, Math.ceil(columnCount / colsPerPage));
  const overflows = columnCount > colsPerPage;

  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);

  const maxOffset = Math.max(0, columnCount * step - gap - viewportWidth);
  const idealOffset = page * colsPerPage * step;
  const offset = overflows ? Math.min(idealOffset, maxOffset) : 0;

  const go = (next: number) => setPage(Math.max(0, Math.min(pageCount - 1, next)));
  const hasPrev = overflows && page > 0;
  const hasNext = overflows && page < pageCount - 1;

  return (
    <div
      className={[
        "kanban-carousel",
        overflows ? "is-overflow" : "is-centered",
        hasPrev ? "has-prev" : "",
        hasNext ? "has-next" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {overflows ? (
        <button
          type="button"
          className="kanban-carousel__nav kanban-carousel__nav--prev"
          aria-label="Previous columns"
          disabled={!hasPrev}
          onClick={() => go(page - 1)}
        >
          ‹
        </button>
      ) : null}

      <div className="kanban-carousel__viewport" ref={viewportRef}>
        <div
          ref={trackRef}
          className="kanban-carousel__track"
          style={overflows ? { transform: `translateX(${-offset}px)` } : undefined}
        >
          {children}
        </div>
      </div>

      {overflows ? (
        <button
          type="button"
          className="kanban-carousel__nav kanban-carousel__nav--next"
          aria-label="Next columns"
          disabled={!hasNext}
          onClick={() => go(page + 1)}
        >
          ›
        </button>
      ) : null}

      {overflows && pageCount > 1 ? (
        <div className="kanban-carousel__dots" role="tablist" aria-label="Column pages">
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === page}
              aria-label={`Page ${i + 1} of ${pageCount}`}
              className={`kanban-carousel__dot${i === page ? " is-active" : ""}`}
              onClick={() => go(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
