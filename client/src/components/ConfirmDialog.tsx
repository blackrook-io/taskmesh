type Props = {
  open: boolean;
  title: string;
  message: string;
  /** Extra alert shown in danger color (e.g. unlink warning). */
  warning?: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  /** When true, only show the confirm button (dismiss / acknowledge). */
  alertOnly?: boolean;
  /** Confirm button style; default danger (destructive) unless alertOnly. */
  confirmTone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  warning,
  confirmLabel = "Delete",
  confirmDisabled = false,
  alertOnly = false,
  confirmTone,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;
  const tone = confirmTone ?? (alertOnly ? "primary" : "danger");
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        {warning ? (
          <p className="confirm-dialog__warning" role="alert">
            {warning}
          </p>
        ) : null}
        <div className="modal-actions">
          {alertOnly ? null : (
            <button type="button" className="btn ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className={tone === "primary" ? "btn primary" : "btn danger"}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
