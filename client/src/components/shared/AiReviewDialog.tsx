import { useEffect, useId, useRef, useState } from "react";
import {
  groupByProject,
  isDeleteProposal,
  proposalExpired,
  proposalHeading,
  uniqueEscalations,
} from "../../lib/aiReview";
import { AiProposalDiff } from "./AiProposalCard";

export type ReviewProposal = {
  id: string;
  action: string;
  method?: string;
  policyAction?: "link" | "tag" | "comment";
  entityType: string;
  entityId?: number;
  projectId?: number | null;
  summary: string;
  fields: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  targetMissing?: boolean;
  stale?: boolean;
  planEscalations?: string[];
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function rowNotice(proposal: ReviewProposal): string | null {
  if (isDeleteProposal(proposal)) return "A person deletes this in the app.";
  if (proposalExpired(proposal)) return "Expired — the target changed since this was proposed.";
  return null;
}

function rowSelectable(proposal: ReviewProposal): boolean {
  return !isDeleteProposal(proposal) && !proposalExpired(proposal);
}

export function AiReviewDialog({
  open,
  proposals,
  applyingId,
  rowErrors,
  onApproveSelected,
  onRejectAll,
  onClose,
}: {
  open: boolean;
  proposals: readonly ReviewProposal[];
  applyingId: string | null;
  rowErrors: Record<string, string>;
  onApproveSelected: (ids: string[]) => void;
  onRejectAll: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const proposalKey = proposals
    .map((proposal) => `${proposal.id}:${proposal.stale ? 1 : 0}:${proposal.targetMissing ? 1 : 0}`)
    .join("|");
  const [selected, setSelected] = useState<string[]>([]);
  const [seenKey, setSeenKey] = useState(proposalKey);
  if (seenKey !== proposalKey) {
    setSeenKey(proposalKey);
    setSelected((current) =>
      current.filter((id) => proposals.some((proposal) => proposal.id === id && rowSelectable(proposal))),
    );
  }

  useEffect(() => {
    if (!open) return;
    const root = dialogRef.current;
    if (!root) return;
    const previously = document.activeElement;
    const focusables = () =>
      [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );
    if (!root.contains(document.activeElement)) focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      if (previously instanceof HTMLElement) previously.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const groups = groupByProject(proposals);
  const escalations = uniqueEscalations(proposals);
  const busy = applyingId != null;

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((item) => item !== id);
    });
  }

  return (
    <div
      className="ai-review-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="ai-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ai-review__head">
          <h2 id={titleId}>Review changes</h2>
          <p className="muted">Nothing is saved until you check a change and choose Approve selected.</p>
        </header>
        {escalations.length > 0 ? (
          <ul className="ai-review__escalations">
            {escalations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <div className="ai-review__body">
          {groups.map((group) => (
            <section key={group.label} className="ai-review__group" aria-label={group.label}>
              <h3>{group.label}</h3>
              {group.items.map((proposal) => {
                const notice = rowNotice(proposal);
                const selectable = rowSelectable(proposal);
                const checked = selected.includes(proposal.id);
                return (
                  <div key={proposal.id} className="ai-review__row">
                    <label className="ai-review__check">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!selectable || busy}
                        onChange={(event) => toggle(proposal.id, event.target.checked)}
                      />
                      <span>{proposalHeading(proposal)}</span>
                    </label>
                    <p className="ai-review__summary">{proposal.summary}</p>
                    {notice ? <p className="ai-proposal-card__notice">{notice}</p> : null}
                    <AiProposalDiff fields={proposal.fields} before={proposal.before} />
                    {rowErrors[proposal.id] ? (
                      <p className="ai-review__error" role="alert">
                        {rowErrors[proposal.id]}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
        <div className="ai-review__actions btn-row">
          <button type="button" className="btn ghost" disabled={busy} onClick={onRejectAll}>
            Reject all
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || selected.length === 0}
            onClick={() => onApproveSelected(selected)}
          >
            {busy ? "Applying…" : "Approve selected"}
          </button>
        </div>
      </div>
    </div>
  );
}
