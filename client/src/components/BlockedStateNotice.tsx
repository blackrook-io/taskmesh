import { useEffect, useState } from "react";
import {
  BLOCKED_NOTICE_EVENT,
  dismissBlockedNotice,
} from "../lib/blockedStateNotice";

export function BlockedStateNotice() {
  const [open, setOpen] = useState(false);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    const onNotice = () => {
      setDontShow(false);
      setOpen(true);
    };
    window.addEventListener(BLOCKED_NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(BLOCKED_NOTICE_EVENT, onNotice);
  }, []);

  if (!open) return null;

  const close = () => {
    if (dontShow) dismissBlockedNotice();
    setOpen(false);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="blocked-state-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="blocked-state-title">Task is Blocked</h2>
        <p>
          This task still depends on unfinished tasks, so it was set to Blocked instead of Ready.
          It becomes Ready automatically when every prerequisite is Complete, Canceled, Deleted, or
          Pending. You can move it back to Draft, or Cancel it.
        </p>
        <div className="field">
          <label htmlFor="blocked-dont-show">
            <input
              id="blocked-dont-show"
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
            />{" "}
            Don&apos;t show again
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={close}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
