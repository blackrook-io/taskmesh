import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchAiActivity, postAiUndo, type AiUndoResult } from "../../api/aiActivity";
import { AiUndoDialog } from "../AiUndoDialog";

function statusLabel(status: string): string {
  if (status === "undone") return "Undone";
  if (status === "skipped") return "Skipped";
  return "Applied";
}

export function AiActivityPanel() {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<{
    id: number;
    change: string;
    canForce: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activityQuery = useQuery({
    queryKey: ["ai-activity"],
    queryFn: fetchAiActivity,
  });

  const undo = useMutation({
    mutationFn: async (input: { id: number; force?: boolean; skip?: boolean }) => {
      const result = await postAiUndo(input.id, { force: input.force, skip: input.skip });
      return { id: input.id, result };
    },
    onSuccess: async ({ result }) => {
      if (!result.ok && result.code === "undo_conflict") {
        return;
      }
      setConflict(null);
      if (!result.ok) setError(result.message);
      else setError(null);
      await queryClient.invalidateQueries({ queryKey: ["ai-activity"] });
    },
  });

  function handleResult(id: number, result: AiUndoResult) {
    if (!result.ok && (result.code === "undo_conflict" || result.code === "undo_target_missing")) {
      setConflict({ id, change: result.change ?? result.message, canForce: result.canForce === true });
      setError(null);
      return;
    }
    if (!result.ok) setError(result.message);
  }

  return (
    <div className="settings-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Changes the assistant applied on its own. Undo stays available for{" "}
        {activityQuery.data?.windowDays ?? 7} days.
      </p>
      {activityQuery.isLoading ? <p className="muted">Loading…</p> : null}
      {activityQuery.isError ? (
        <p role="alert">{(activityQuery.error as Error).message}</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {activityQuery.data && activityQuery.data.items.length === 0 ? (
        <p className="muted">No automatic changes in the undo window.</p>
      ) : null}
      {activityQuery.data && activityQuery.data.items.length > 0 ? (
        <ul className="ai-activity-list">
          {activityQuery.data.items.map((row) => (
            <li key={row.id} className="ai-activity-list__row">
              <div>
                <strong>{row.summary}</strong>
                <p className="muted">
                  {new Date(row.appliedAt).toLocaleString()} · {statusLabel(row.status)}
                </p>
              </div>
              {row.status === "applied" ? (
                <button
                  type="button"
                  className="btn small"
                  disabled={undo.isPending}
                  onClick={() => {
                    setError(null);
                    void undo.mutateAsync({ id: row.id }).then(({ result }) => handleResult(row.id, result));
                  }}
                >
                  Undo
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {conflict ? (
        <AiUndoDialog
          change={conflict.change}
          canForce={conflict.canForce}
          busy={undo.isPending}
          onClose={() => setConflict(null)}
          onSkip={() => {
            void undo.mutateAsync({ id: conflict.id, skip: true }).then(({ result }) => {
              if (result.ok) setConflict(null);
              else setError(result.message);
            });
          }}
          onUndoAnyway={() => {
            void undo.mutateAsync({ id: conflict.id, force: true }).then(({ result }) => {
              handleResult(conflict.id, result);
              if (result.ok) setConflict(null);
            });
          }}
        />
      ) : null}
    </div>
  );
}
