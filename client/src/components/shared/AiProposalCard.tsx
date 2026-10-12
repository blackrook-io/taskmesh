import { diffLines } from "../../lib/aiReview";

function clip(text: string): string {
  return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}

export function AiProposalDiff({
  fields,
  before,
}: {
  fields: Record<string, unknown>;
  before?: Record<string, unknown> | null;
}) {
  const lines = diffLines(fields, before);
  if (lines.length === 0) return <p className="ai-proposal-diff__empty">(no fields)</p>;
  return (
    <ul className="ai-proposal-diff">
      {lines.map((line) => (
        <li key={line.key} className={`ai-proposal-diff__line ai-proposal-diff__line--${line.kind}`}>
          <span className="ai-proposal-diff__key">{line.key}</span>
          {line.kind === "change" ? (
            <>
              <span className="ai-proposal-diff__before">{clip(line.beforeText ?? "∅")}</span>
              <span className="ai-proposal-diff__arrow" aria-hidden>
                →
              </span>
              <span className="ai-proposal-diff__after">{clip(line.afterText)}</span>
            </>
          ) : (
            <span className="ai-proposal-diff__after">{clip(line.afterText)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AiProposalCard({
  heading,
  summary,
  fields,
  before,
  notice,
  compact = false,
  applyLabel = "Apply",
  dismissLabel = "Dismiss",
  applying = false,
  dismissing = false,
  applyDisabled = false,
  dismissDisabled = false,
  onApply,
  onDismiss,
}: {
  heading?: string;
  summary?: string;
  fields?: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  notice?: string;
  compact?: boolean;
  applyLabel?: string;
  dismissLabel?: string;
  applying?: boolean;
  dismissing?: boolean;
  applyDisabled?: boolean;
  dismissDisabled?: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <article className={`ai-proposal-card${compact ? " ai-proposal-card--compact" : ""}`}>
      {heading ? (
        <header className="ai-proposal-card__head">
          <strong>{heading}</strong>
        </header>
      ) : null}
      {summary ? <p className="ai-proposal-card__summary">{summary}</p> : null}
      {notice ? <p className="ai-proposal-card__notice">{notice}</p> : null}
      {fields ? <AiProposalDiff fields={fields} before={before} /> : null}
      <div className={`btn-row${compact ? " mesh-card__actions" : ""}`}>
        <button
          type="button"
          className="btn small ghost"
          disabled={dismissDisabled || dismissing || applying}
          onClick={onDismiss}
        >
          {dismissing ? "Dismissing…" : dismissLabel}
        </button>
        <button
          type="button"
          className="btn small primary"
          disabled={applyDisabled || applying || dismissing}
          onClick={onApply}
        >
          {applying ? "Applying…" : applyLabel}
        </button>
      </div>
    </article>
  );
}
