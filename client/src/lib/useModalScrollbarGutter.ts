import { useEffect, type RefObject } from "react";

/**
 * When `scrollRef` overflows vertically, widen the closest `[role="dialog"]` by
 * scrollbar width + gap and pad the scroll container — same rules as Edit Task.
 */
export function useModalScrollbarGutter(
  scrollRef: RefObject<HTMLElement | null>,
  options?: { enabled?: boolean; cssVar?: string },
): void {
  const enabled = options?.enabled ?? true;
  const cssVar = options?.cssVar ?? "--task-modal-extra";

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    const dialog = el?.closest('[role="dialog"]') as HTMLElement | null;
    if (!el || !dialog) return;

    let raf = 0;
    const GAP = 20;
    const measure = () => {
      const scrollbarWidth = el.offsetWidth - el.clientWidth;
      const hasScroll = el.scrollHeight > el.clientHeight + 1;
      if (hasScroll) {
        el.style.paddingRight = `${GAP}px`;
        dialog.style.setProperty(cssVar, `${Math.max(scrollbarWidth, 0) + GAP}px`);
      } else {
        el.style.paddingRight = "";
        dialog.style.setProperty(cssVar, "0px");
      }
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const mo = new MutationObserver(schedule);
    mo.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      dialog.style.removeProperty(cssVar);
      el.style.paddingRight = "";
    };
  }, [scrollRef, enabled, cssVar]);
}
