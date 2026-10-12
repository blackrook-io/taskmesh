import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { postAiUndo } from "../api/aiActivity";
import { AiUndoDialog } from "./AiUndoDialog";

type Toast = { journalId: number; summary: string; failed?: string };

export function AiApplyToastHost() {
  const queryClient = useQueryClient();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [conflict, setConflict] = useState<{
    id: number;
    change: string;
    canForce: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onApplied = (event: Event) => {
      const detail = (event as CustomEvent<{ journalId: number; summary: string }>).detail;
      if (!detail || typeof detail.journalId !== "number") return;
      setToasts((list) => [...list, { journalId: detail.journalId, summary: detail.summary }]);
    };
    const onFailed = (event: Event) => {
      const detail = (event as CustomEvent<{ summary: string; message: string }>).detail;
      if (!detail) return;
      setToasts((list) => [
        ...list,
        { journalId: -Date.now(), summary: detail.summary, failed: detail.message },
      ]);
    };
    window.addEventListener("taskmesh:ai-applied", onApplied);
    window.addEventListener("taskmesh:ai-apply-failed", onFailed);
    return () => {
      window.removeEventListener("taskmesh:ai-applied", onApplied);
      window.removeEventListener("taskmesh:ai-apply-failed", onFailed);
    };
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => {
      setToasts((list) => list.slice(1));
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  async function undo(journalId: number, body: { force?: boolean; skip?: boolean } = {}) {
    setBusy(true);
    try {
      const result = await postAiUndo(journalId, body);
      if (!result.ok && (result.code === "undo_conflict" || result.code === "undo_target_missing")) {
        setConflict({
          id: journalId,
          change: result.change ?? result.message,
          canForce: result.canForce === true,
        });
        return;
      }
      setConflict(null);
      setToasts((list) => list.filter((toast) => toast.journalId !== journalId));
      await queryClient.invalidateQueries({ queryKey: ["ai-activity"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="ai-toast-host" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.journalId} className="ai-toast" role="status">
            <p>{toast.failed ? `${toast.summary}: ${toast.failed}` : toast.summary}</p>
            {toast.failed ? null : (
              <button type="button" className="btn small" disabled={busy} onClick={() => void undo(toast.journalId)}>
                Undo
              </button>
            )}
          </div>
        ))}
      </div>
      {conflict ? (
        <AiUndoDialog
          change={conflict.change}
          canForce={conflict.canForce}
          busy={busy}
          onClose={() => setConflict(null)}
          onSkip={() => void undo(conflict.id, { skip: true })}
          onUndoAnyway={() => void undo(conflict.id, { force: true })}
        />
      ) : null}
    </>
  );
}
