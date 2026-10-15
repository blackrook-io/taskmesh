import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiJson } from "../api/client";
import { formatEntityRef } from "../lib/entityRef";
import { parseEstimateHours } from "../../../src/lib/estimateHours.ts";

export type PlanCandidate = {
  entityType: "task" | "todo";
  entityId: number;
  number: number;
  title: string;
  childCount: number;
  otherPlans: Array<{ id: number; number: number; title: string }>;
};

export function PlanPhaseTools({
  planId,
  phaseId,
  phaseName,
  pickerOpen,
  busy,
  onClosePicker,
  onPick,
  onQuickAdd,
}: {
  planId: number;
  phaseId: number;
  phaseName: string;
  pickerOpen: boolean;
  busy: boolean;
  onClosePicker: () => void;
  onPick: (candidate: PlanCandidate) => void;
  onQuickAdd: (title: string, hours: number | null) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const candidates = useQuery({
    queryKey: ["plan-candidates", planId, debounced],
    enabled: pickerOpen,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debounced.trim()) params.set("q", debounced.trim());
      const res = await apiJson<{ data: PlanCandidate[] }>(
        `/api/v1/plans/${planId}/candidates?${params}`,
      );
      return res.data;
    },
  });

  return (
    <div className="plan-phase-tools">
      {pickerOpen ? (
        <div className="plan-phase-tools__picker" role="region" aria-label={`Add items to ${phaseName}`}>
          <div className="plan-phase-tools__bar">
            <button type="button" className="btn small ghost" onClick={onClosePicker}>
              Close
            </button>
          </div>
          <input
            type="text"
            value={query}
            placeholder="Search number or title"
            aria-label={`Search items for ${phaseName}`}
            onChange={(event) => setQuery(event.target.value)}
          />
          {candidates.isLoading ? <p className="muted">Searching…</p> : null}
          {candidates.isError ? <p role="alert">{(candidates.error as Error).message}</p> : null}
          {candidates.data && candidates.data.length === 0 ? (
            <p className="muted">Nothing to add.</p>
          ) : null}
          {candidates.data && candidates.data.length > 0 ? (
            <ul className="plan-phase-tools__results">
              {candidates.data.map((candidate) => (
                <li key={`${candidate.entityType}:${candidate.entityId}`}>
                  <button
                    type="button"
                    className="plan-phase-tools__result"
                    disabled={busy}
                    onClick={() => onPick(candidate)}
                  >
                    <span className="plan-board__ref">
                      {formatEntityRef(candidate.entityType, candidate.number)}
                    </span>
                    <span>{candidate.title}</span>
                    {candidate.otherPlans.map((plan) => (
                      <span key={plan.id} className="plan-phase-tools__badge">
                        {formatEntityRef("plan", plan.number)}
                      </span>
                    ))}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <form
        className="plan-phase-tools__quick"
        onSubmit={(event) => {
          event.preventDefault();
          const nextTitle = title.trim();
          if (!nextTitle || busy) return;
          const parsed = parseEstimateHours(hours);
          if (parsed === "invalid") {
            setFormError("Hours must be a quarter-hour value.");
            return;
          }
          setFormError(null);
          void onQuickAdd(nextTitle, parsed)
            .then(() => {
              setTitle("");
              setHours("");
            })
            .catch(() => {
              // The board surfaces the server message.
            });
        }}
      >
        <label className="sr-only" htmlFor={`plan-quick-${phaseId}`}>
          New draft task in {phaseName}
        </label>
        <input
          id={`plan-quick-${phaseId}`}
          type="text"
          value={title}
          placeholder="New draft task"
          maxLength={2000}
          onChange={(event) => setTitle(event.target.value)}
        />
        <input
          type="text"
          className="plan-phase-tools__hours"
          value={hours}
          inputMode="decimal"
          placeholder="Hours"
          aria-label={`Hours for a new task in ${phaseName}`}
          onChange={(event) => setHours(event.target.value)}
        />
        <button type="submit" className="btn small" disabled={busy || !title.trim()}>
          Add
        </button>
      </form>
      {formError ? (
        <p className="plan-board__notice" role="alert">
          {formError}
        </p>
      ) : null}
    </div>
  );
}
