type Props = {
  change: string;
  canForce: boolean;
  busy: boolean;
  onUndoAnyway: () => void;
  onSkip: () => void;
  onClose: () => void;
};

export function AiUndoDialog({ change, canForce, busy, onUndoAnyway, onSkip, onClose }: Props) {
  return (
    <div className="ai-undo-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="ai-undo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-undo-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="ai-undo-dialog-title">This record changed</h2>
        <p>{change}</p>
        <div className="ai-undo-dialog__actions">
          {canForce ? (
            <button type="button" className="btn primary" disabled={busy} onClick={onUndoAnyway}>
              Undo anyway
            </button>
          ) : null}
          <button type="button" className="btn" disabled={busy} onClick={onSkip}>
            Skip
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
