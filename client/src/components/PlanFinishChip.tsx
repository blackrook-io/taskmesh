import { useState } from "react";
import { planFinishPresentation, type PlanProjection } from "../lib/planProjection";

type Props = {
  projection: PlanProjection | undefined;
  pending: boolean;
  onSaveCapacity: (hours: number) => Promise<void>;
};

function parseCapacity(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value > 999.99) return null;
  return value;
}

export function PlanFinishChip({ projection, pending, onSaveCapacity }: Props) {
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState("");
  const [error, setError] = useState<string | null>(null);
  const view = projection ? planFinishPresentation(projection) : null;
  const canEdit = projection?.driver === "needs_capacity" && projection.canSetCapacity;

  const close = () => {
    setOpen(false);
    setHours("");
    setError(null);
  };

  const save = async () => {
    const value = parseCapacity(hours);
    if (value == null) {
      setError("Enter hours per week, up to 999.99.");
      return;
    }
    setError(null);
    try {
      await onSaveCapacity(value);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save capacity");
    }
  };

  return (
    <>
      {canEdit ? (
        <button
          type="button"
          className="plan-board__finish plan-board__finish--prompt"
          onClick={() => setOpen(true)}
        >
          {view?.label ?? "Set weekly capacity"}
        </button>
      ) : (
        <span
          className={
            view && projection?.driver !== "needs_capacity" && projection?.driver !== "needs_estimates"
              ? "plan-board__finish"
              : "plan-board__finish plan-board__finish--muted"
          }
        >
          <span>{view?.label ?? "Finish date —"}</span>
          {view?.detail ? <span className="plan-board__finish-detail">{view.detail}</span> : null}
        </span>
      )}
      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={close}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-capacity-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="plan-capacity-title">Weekly capacity</h2>
            <p>Hours this plan can finish in a week. The finish range uses this until recent completions are enough.</p>
            <div className="field">
              <label htmlFor="plan-capacity-hours">Hours per week</label>
              <input
                id="plan-capacity-hours"
                type="number"
                min={0.01}
                max={999.99}
                step={0.01}
                value={hours}
                onChange={(event) => setHours(event.target.value)}
              />
            </div>
            {error ? (
              <p className="plan-board__notice" role="alert">
                {error}
              </p>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={close}>
                Cancel
              </button>
              <button type="button" className="btn primary" disabled={pending} onClick={() => void save()}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
