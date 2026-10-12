import { useState } from "react";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
};

export function StateReasonDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  const [comment, setComment] = useState("");
  const [seenOpen, setSeenOpen] = useState(false);
  if (open && !seenOpen) {
    setSeenOpen(true);
    setComment("");
  } else if (!open && seenOpen) {
    setSeenOpen(false);
  }
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="state-reason-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="state-reason-title">{title}</h2>
        <p>{message}</p>
        <div className="field">
          <label htmlFor="state-reason-comment">Comment</label>
          <textarea
            id="state-reason-comment"
            value={comment}
            rows={4}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!comment.trim()}
            onClick={() => onConfirm(comment.trim())}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
