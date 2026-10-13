import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { apiJson } from "../../api/client";
import {
  TASK_STATE_LABELS,
  formatTaskNumber,
  taskStateClass,
  type TaskState,
} from "../../lib/taskFields";

import { stateWaitingDescribedBy } from "./stateWaitingDescribedBy";

type WaitingTask = {
  id: number;
  number: number;
  title: string;
  state: string;
};

const SHOW_MS = 200;
const HIDE_MS = 180;

function panelPosition(anchor: DOMRect): { top: number; left: number; width: number } {
  const gap = 6;
  const width = Math.min(352, window.innerWidth - 16);
  let left = anchor.right + gap;
  if (left + width > window.innerWidth - 8) {
    left = Math.max(8, anchor.left - width - gap);
  }
  const estimated = 36 + 10 * 28;
  let top = anchor.top;
  if (top + estimated > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - 8 - estimated);
  }
  return { top, left, width };
}

/** Hover and keyboard-focus explanation for Pending and Blocked list states. */
export function StateWaitingHint({
  taskId,
  state,
  children,
}: {
  taskId: number;
  state: string;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const requestSeq = useRef(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [tasks, setTasks] = useState<WaitingTask[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [trackedState, setTrackedState] = useState(state);
  const panelId = `task-state-waiting-${taskId}`;
  const explains = state === "pending" || state === "blocked";
  if (state !== trackedState) {
    setTrackedState(state);
    setPos(null);
    setTasks(null);
    setFailed(false);
  }

  useEffect(() => {
    return () => {
      if (showTimer.current != null) window.clearTimeout(showTimer.current);
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    const reposition = (event: Event) => {
      if (!pos) return;
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor || (anchor.width === 0 && anchor.height === 0)) {
        requestSeq.current += 1;
        setPos(null);
        return;
      }
      const next = panelPosition(anchor);
      setPos((prev) =>
        prev && prev.top === next.top && prev.left === next.left && prev.width === next.width
          ? prev
          : next,
      );
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [pos]);

  if (!explains) return <>{children}</>;

  function clearShow() {
    if (showTimer.current != null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  }

  function clearHide() {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  function hide() {
    clearShow();
    clearHide();
    requestSeq.current += 1;
    setPos(null);
  }

  function scheduleHide() {
    clearHide();
    hideTimer.current = window.setTimeout(hide, HIDE_MS);
  }

  function reveal() {
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setPos(panelPosition(anchor));
    setFailed(false);
    setTasks(null);
    void apiJson<{ data: { tasks: WaitingTask[] } }>(`/api/v1/tasks/${taskId}/waiting-on`)
      .then((res) => {
        if (requestSeq.current !== seq) return;
        setTasks(res.data.tasks);
      })
      .catch(() => {
        if (requestSeq.current !== seq) return;
        setFailed(true);
        setTasks([]);
      });
  }

  function armShow(delay: number) {
    clearHide();
    if (pos) return;
    if (showTimer.current != null) {
      if (delay > 0) return;
      clearShow();
    }
    showTimer.current = window.setTimeout(() => {
      showTimer.current = null;
      reveal();
    }, delay);
  }

  return (
    <stateWaitingDescribedBy.Provider value={pos ? panelId : undefined}>
      <span
        ref={anchorRef}
        className="task-state-waiting-anchor"
        tabIndex={state === "pending" ? 0 : undefined}
        aria-label={state === "pending" ? "State" : undefined}
        aria-describedby={pos ? panelId : undefined}
        onPointerEnter={() => armShow(SHOW_MS)}
        onPointerLeave={scheduleHide}
        onFocus={() => armShow(0)}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (
            next instanceof Node &&
            (anchorRef.current?.contains(next) || panelRef.current?.contains(next))
          ) {
            return;
          }
          hide();
        }}
      >
        {children}
      </span>
      {pos
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="region"
              aria-label="Waiting on"
              className="task-state-waiting"
              style={{ top: pos.top, left: pos.left, width: pos.width }}
              onPointerEnter={clearHide}
              onPointerLeave={scheduleHide}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <p className="task-state-waiting__label">Waiting on</p>
              <div className="task-state-waiting__list">
                {failed ? (
                  <p className="task-state-waiting__empty">Could not load</p>
                ) : tasks == null ? (
                  <p className="task-state-waiting__empty">Loading…</p>
                ) : tasks.length === 0 ? (
                  <p className="task-state-waiting__empty">Nothing waiting</p>
                ) : (
                  tasks.map((task) => (
                    <div key={task.id} className="task-state-waiting__row">
                      <span className="task-state-waiting__num muted">
                        {formatTaskNumber(task.number)}
                      </span>
                      <span className="task-state-waiting__title">{task.title}</span>
                      <span
                        className={taskStateClass(
                          "task-state-waiting__state",
                          task.state as TaskState,
                        )}
                      >
                        {TASK_STATE_LABELS[task.state as TaskState] ?? task.state}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </stateWaitingDescribedBy.Provider>
  );
}
