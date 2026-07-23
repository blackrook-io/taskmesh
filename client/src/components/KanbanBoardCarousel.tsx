import {
  Children,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

const FALLBACK_COL = 280;
const FALLBACK_GAP = 12;
const PEEK = 28;

type Props = {
  columnCount: number;
  boardKey: number | string;
  /** When true, blank-hover reporting is disabled (e.g. card drag). */
  suppressBlankHover?: boolean;
  /** Keep ghost visible while naming even if pointer leaves briefly. */
  lockGhost?: boolean;
  /** Index 0..columnCount where the ghost should appear; null = no ghost. */
  ghostInsertAt: number | null;
  ghost: ReactNode;
  /** Fired when blank-area hover maps to an insert index; null when left blank zone. */
  onBlankHover: (insertAt: number | null) => void;
  children: ReactNode;
};

function isInteractiveColumnTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(".kanban-column-ghost")) return false;
  if (target.closest(".kanban-carousel__nav, .kanban-carousel__dots")) return true;
  return Boolean(target.closest(".kanban-column"));
}

export function KanbanBoardCarousel({
  columnCount,
  boardKey,
  suppressBlankHover = false,
  lockGhost = false,
  ghostInsertAt,
  ghost,
  onBlankHover,
  children,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [colWidth, setColWidth] = useState(FALLBACK_COL);
  const [gap, setGap] = useState(FALLBACK_GAP);
  const [page, setPage] = useState(0);

  const showGhost = ghostInsertAt != null && ghost != null;
  const visualCount = columnCount + (showGhost ? 1 : 0);

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
  }, [visualCount, boardKey]);

  useEffect(() => {
    setPage(0);
  }, [boardKey, columnCount]);

  const step = colWidth + gap;
  const colsPerPage = useMemo(() => {
    if (viewportWidth <= 0 || step <= 0) return 1;
    const usable = Math.max(colWidth, viewportWidth - PEEK * 2);
    return Math.max(1, Math.floor((usable + gap) / step));
  }, [viewportWidth, step, colWidth, gap]);

  const pageCount = Math.max(1, Math.ceil(visualCount / colsPerPage));
  const overflows = visualCount > colsPerPage;

  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);

  const maxOffset = Math.max(0, visualCount * step - gap - viewportWidth);
  const idealOffset = page * colsPerPage * step;
  const offset = overflows ? Math.min(idealOffset, maxOffset) : 0;

  const go = (next: number) => setPage(Math.max(0, Math.min(pageCount - 1, next)));
  const hasPrev = overflows && page > 0;
  const hasNext = overflows && page < pageCount - 1;

  const computeInsertAt = (clientX: number): number => {
    const track = trackRef.current;
    if (!track || columnCount === 0) return 0;
    const cols = [
      ...track.querySelectorAll<HTMLElement>(".kanban-column:not(.kanban-column-ghost)"),
    ];
    if (cols.length === 0) return 0;
    for (let i = 0; i < cols.length; i++) {
      const rect = cols[i]!.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (clientX < mid) return i;
    }
    return cols.length;
  };

  const handlePointerMove = (e: ReactPointerEvent) => {
    if (suppressBlankHover || lockGhost) return;
    if (isInteractiveColumnTarget(e.target)) {
      onBlankHover(null);
      return;
    }
    onBlankHover(computeInsertAt(e.clientX));
  };

  const handlePointerLeave = (e: ReactPointerEvent) => {
    if (lockGhost) return;
    const root = rootRef.current;
    if (!root) return;
    const related = e.relatedTarget;
    if (related instanceof Node && root.contains(related)) return;
    onBlankHover(null);
  };

  const columnNodes = Children.toArray(children);
  const trackChildren: ReactNode[] = [];
  if (showGhost && ghostInsertAt === 0) trackChildren.push(ghost);
  columnNodes.forEach((node, i) => {
    trackChildren.push(node);
    if (showGhost && ghostInsertAt === i + 1) trackChildren.push(ghost);
  });

  return (
    <div
      ref={rootRef}
      className={[
        "kanban-carousel",
        overflows ? "is-overflow" : "is-centered",
        hasPrev ? "has-prev" : "",
        hasNext ? "has-next" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
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
          {trackChildren.length > 0 ? (
            trackChildren
          ) : showGhost ? (
            ghost
          ) : (
            <div className="kanban-carousel__empty-hit" aria-hidden />
          )}
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
