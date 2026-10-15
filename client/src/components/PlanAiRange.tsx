import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiJson } from "../api/client";
import { putAssistantFeedback } from "../api/assistant";
import type { PlanProjection } from "../lib/planProjection";

type AiView = NonNullable<PlanProjection["ai"]>;

type Props = {
  planId: number;
  projection: PlanProjection | undefined;
  assistantBlocked: boolean;
};

function formatUtcDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function rangeLabel(ai: AiView): string {
  const start = formatUtcDate(ai.p50);
  const end = formatUtcDate(ai.p80);
  return start === end ? start : `${start} – ${end}`;
}

export function PlanAiRange({ planId, projection, assistantBlocked }: Props) {
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thumb, setThumb] = useState<"thumb_up" | "thumb_down" | null>(null);
  const ai = projection?.ai ?? null;
  const enabled = projection?.aiEnabled === true;

  const refine = useMutation({
    mutationFn: async (force: boolean) => {
      const res = await apiJson<{ data: { ai: AiView | null; note: string | null } }>(
        `/api/v1/plans/${planId}/projection/ai`,
        { method: "POST", body: JSON.stringify({ force }) },
      );
      return res.data;
    },
    onSuccess: async (data) => {
      setNote(data.note);
      setError(null);
      setThumb(null);
      await qc.invalidateQueries({ queryKey: ["plan-projection", planId] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not refine the finish range");
    },
  });

  if (!enabled && !ai) return null;
  if (!ai && assistantBlocked) return null;

  const rate = async (kind: "thumb_up" | "thumb_down") => {
    if (!ai?.auditId) return;
    setThumb(kind);
    try {
      await putAssistantFeedback({ auditId: ai.auditId, kind });
    } catch (err) {
      setThumb(null);
      setError(err instanceof Error ? err.message : "Could not save feedback");
    }
  };

  return (
    <div className={`plan-ai${ai?.stale ? " plan-ai--stale" : ""}`}>
      {ai ? (
        <>
          <span className="plan-ai__range">{rangeLabel(ai)}</span>
          <span className="plan-ai__meta">
            AI {ai.confidence}
            {ai.stale ? " · out of date" : ""}
          </span>
          {ai.drivers.length > 0 ? (
            <ul className="plan-ai__drivers">
              {ai.drivers.map((driver, index) => (
                <li key={`${index}:${driver}`}>{driver}</li>
              ))}
            </ul>
          ) : null}
          {ai.auditId != null ? (
            <div className="assistant-feedback">
              <button
                type="button"
                className={`assistant-feedback__thumb${thumb === "thumb_up" ? " is-on" : ""}`}
                aria-pressed={thumb === "thumb_up"}
                aria-label="Helpful forecast"
                onClick={() => void rate("thumb_up")}
              >
                ▲
              </button>
              <button
                type="button"
                className={`assistant-feedback__thumb${thumb === "thumb_down" ? " is-on" : ""}`}
                aria-pressed={thumb === "thumb_down"}
                aria-label="Unhelpful forecast"
                onClick={() => void rate("thumb_down")}
              >
                ▼
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {enabled && (!ai || ai.stale) && !assistantBlocked ? (
        <button
          type="button"
          className="btn plan-ai__refine"
          disabled={refine.isPending}
          onClick={() => refine.mutate(ai?.stale === true)}
        >
          {refine.isPending ? "Refining…" : "Refine with AI"}
        </button>
      ) : null}
      {note ? <p className="plan-ai__note">{note}</p> : null}
      {error ? (
        <p className="plan-ai__note" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
