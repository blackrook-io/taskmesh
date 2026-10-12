import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  fetchAssistantStatus,
  putAssistantFeedback,
  streamAssistantChat,
  type AssistantProposal,
  type ChatTurn,
} from "../api/assistant";
import { apiJson, ApiRequestError } from "../api/client";
import { useAssistantAttachTarget } from "../lib/assistantAttach";
import { isDeleteProposal, proposalExpired, proposalHeading } from "../lib/aiReview";
import { showAiAppliedToast, showAiApplyFailedToast } from "../lib/aiApplyToast";
import { dispatchOpenSettings } from "../lib/settings";
import { AiProposalCard } from "./shared/AiProposalCard";
import { AiReviewDialog } from "./shared/AiReviewDialog";

const TRANSCRIPT_KEY = "taskmesh.assistant.transcript";

type Props = {
  open: boolean;
  onClose: () => void;
};

function loadTranscript(): ChatTurn[] {
  try {
    const raw = localStorage.getItem(TRANSCRIPT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatTurn[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t) =>
          t &&
          (t.role === "user" || t.role === "assistant") &&
          typeof t.content === "string",
      )
      .map((t) => ({
        role: t.role,
        content: t.content,
        ...(typeof t.auditId === "number" ? { auditId: t.auditId } : {}),
        ...(t.feedback === "thumb_up" || t.feedback === "thumb_down" ? { feedback: t.feedback } : {}),
        ...(typeof t.feedbackNote === "string" ? { feedbackNote: t.feedbackNote } : {}),
      }))
      .slice(-40);
  } catch {
    return [];
  }
}

function saveTranscript(turns: ChatTurn[]) {
  try {
    localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(turns.slice(-40)));
  } catch {
    /* ignore quota */
  }
}

function ThumbIcon({ down = false }: { down?: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      style={down ? { transform: "scaleY(-1)" } : undefined}
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

export function AssistantPanel({ open, onClose }: Props) {
  const qc = useQueryClient();
  const attachTarget = useAssistantAttachTarget();
  const [attachEnabled, setAttachEnabled] = useState(true);
  const [seenAttachKey, setSeenAttachKey] = useState(attachTarget?.key);
  if (attachTarget?.key !== seenAttachKey) {
    setSeenAttachKey(attachTarget?.key);
    if (attachTarget) setAttachEnabled(true);
  }
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>(() => loadTranscript());
  const [streaming, setStreaming] = useState("");
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<AssistantProposal[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const closeReview = useCallback(() => setReviewOpen(false), []);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const statusQuery = useQuery({
    queryKey: ["assistant-status"],
    queryFn: fetchAssistantStatus,
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (reviewOpen) {
        setReviewOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, reviewOpen]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, turns, streaming, toolNote, proposals]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    saveTranscript(turns);
  }, [turns]);

  const applyMutation = useMutation({
    mutationFn: async (p: AssistantProposal) => {
      if (!p.path || !p.method) {
        throw new Error("Invalid proposal (missing path/method). Restart TaskMesh and try again.");
      }
      setApplyingId(p.id);
      await apiJson("/api/v1/assistant/proposals/apply", {
        method: "POST",
        body: JSON.stringify(p),
      });
      return p;
    },
    onSuccess: (p) => {
      setApplyingId(null);
      setProposals((list) => list.filter((x) => x.id !== p.id));
      if (p.entityType === "idea") {
        void qc.invalidateQueries({ queryKey: ["ideas"] });
      } else if (p.entityType === "document" && p.projectId != null) {
        void qc.invalidateQueries({ queryKey: ["documents", p.projectId] });
      } else if (p.entityType === "task") {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        if (p.projectId != null) {
          void qc.invalidateQueries({ queryKey: ["tasks", p.projectId] });
        }
      } else if (p.entityType === "todo") {
        void qc.invalidateQueries({ queryKey: ["todos"] });
        void qc.invalidateQueries({ queryKey: ["todo-lists"] });
      } else if (p.entityType === "todo_list") {
        void qc.invalidateQueries({ queryKey: ["todo-lists"] });
      }
      if (p.policyAction === "tag") {
        void qc.invalidateQueries({ queryKey: ["tags"] });
      }
      const verb = p.action === "create" ? "Created" : "Updated";
      const target =
        p.action === "create"
          ? `${p.entityType}${p.projectId != null ? ` in project #${p.projectId}` : ""}`
          : `${p.entityType} #${p.entityId}`;
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: `${verb} ${target}: ${p.summary}`,
        },
      ]);
    },
    onError: (e: Error, proposal) => {
      setApplyingId(null);
      if (e instanceof ApiRequestError && e.status === 409) {
        setProposals((list) =>
          list.map((item) => (item.id === proposal.id ? { ...item, stale: true } : item)),
        );
        return;
      }
      setError(e.message);
    },
  });

  async function rateTurn(index: number, kind: "thumb_up" | "thumb_down") {
    const turn = turns[index];
    if (!turn || turn.auditId == null) return;
    const previous = turns;
    const note = turn.feedbackNote ?? "";
    setTurns((list) =>
      list.map((item, i) => (i === index ? { ...item, feedback: kind } : item)),
    );
    try {
      await putAssistantFeedback({
        auditId: turn.auditId,
        kind,
        note: note.trim() ? note : null,
      });
    } catch (e) {
      setTurns(previous);
      setError(e instanceof Error ? e.message : "Could not save feedback");
    }
  }

  async function saveTurnNote(index: number, note: string) {
    const turn = turns[index];
    if (!turn || turn.auditId == null || !turn.feedback) return;
    setTurns((list) =>
      list.map((item, i) => (i === index ? { ...item, feedbackNote: note } : item)),
    );
    try {
      await putAssistantFeedback({
        auditId: turn.auditId,
        kind: turn.feedback,
        note: note.trim() ? note : null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save feedback");
    }
  }

  async function dismissProposal(proposal: AssistantProposal) {
    setDismissingId(proposal.id);
    setError(null);
    try {
      if (proposal.auditId != null) {
        await putAssistantFeedback({ auditId: proposal.auditId, kind: "dismiss" });
      }
      setProposals((list) => list.filter((item) => item.id !== proposal.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not dismiss");
    } finally {
      setDismissingId(null);
    }
  }

  async function approveSelected(ids: string[]) {
    for (const id of ids) {
      const proposal = proposals.find((item) => item.id === id);
      if (!proposal || proposalExpired(proposal) || isDeleteProposal(proposal)) continue;
      try {
        await applyMutation.mutateAsync(proposal);
        setRowErrors((current) => {
          if (!(id in current)) return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not apply";
        setRowErrors((current) => ({ ...current, [id]: message }));
      }
    }
  }

  async function rejectTier3() {
    const pending = proposals.filter((item) => (item.planTier ?? 2) >= 3);
    for (const proposal of pending) {
      await dismissProposal(proposal);
    }
    setReviewOpen(false);
  }

  const send = useMutation({
    mutationFn: async (message: string) => {
      setError(null);
      setBusy(true);
      setStreaming("");
      setToolNote(null);
      const history = turns;
      setTurns((t) => [...t, { role: "user", content: message }]);
      const ac = new AbortController();
      abortRef.current = ac;
      let full = "";
      const turnProposals: AssistantProposal[] = [];
      try {
        const pageContext =
          attachEnabled && attachTarget ? attachTarget.getContext().slice(0, 16_000) : null;
        const done = await streamAssistantChat({
          message,
          history,
          pageContext,
          signal: ac.signal,
          onDelta: (text) => {
            full += text;
            setStreaming(full);
          },
          onTool: (info) => {
            setToolNote(`Using ${info.name}…`);
          },
          onProposal: (proposal) => {
            if (turnProposals.some((item) => item.id === proposal.id)) return;
            turnProposals.push(proposal);
          },
          onApplied: (applied) => {
            showAiAppliedToast(applied);
          },
          onApplyFailed: (failed) => {
            showAiApplyFailedToast(failed);
          },
        });
        if (!ac.signal.aborted) {
          setTurns((t) => [
            ...t,
            {
              role: "assistant",
              content: full.trim() || "(empty reply)",
              ...(done.auditId != null ? { auditId: done.auditId } : {}),
            },
          ]);
          if (turnProposals.length > 0) {
            const planTier = done.planTier ?? 2;
            const stamped = turnProposals.map((proposal) => ({
              ...proposal,
              planTier,
              planEscalations: done.planEscalations,
            }));
            setProposals((list) => {
              const ids = new Set(list.map((item) => item.id));
              return [...list, ...stamped.filter((item) => !ids.has(item.id))];
            });
            if (planTier >= 3) setReviewOpen(true);
          }
        }
        setStreaming("");
        setToolNote(null);
      } catch (e) {
        const aborted =
          (e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message)));
        if (aborted) {
          if (full.trim()) {
            setTurns((t) => [...t, { role: "assistant", content: full.trim() }]);
          }
          setStreaming("");
          setToolNote(null);
          return;
        }
        throw e;
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    onError: (e: Error) => {
      if (e.name === "AbortError" || /aborted/i.test(e.message)) {
        setStreaming("");
        setToolNote(null);
        setBusy(false);
        return;
      }
      setError(e.message);
      setStreaming("");
      setToolNote(null);
      setBusy(false);
    },
  });

  if (!open) return null;

  const enabled = statusQuery.data?.enabled ?? false;
  const tier3 = proposals.filter((proposal) => (proposal.planTier ?? 2) >= 3);
  const tier2 = proposals.filter((proposal) => (proposal.planTier ?? 2) < 3);

  return (
    <div className="assistant-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="assistant-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="assistant-panel__head">
          <div>
            <h2 id="assistant-title">Assistant</h2>
            <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>
              {statusQuery.isLoading
                ? "Checking…"
                : enabled
                  ? `${statusQuery.data!.provider} · ${statusQuery.data!.model}`
                  : "Not configured"}
            </p>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn small ghost"
              disabled={busy || (turns.length === 0 && proposals.length === 0)}
              onClick={() => {
                setTurns([]);
                setProposals([]);
                saveTranscript([]);
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                onClose();
                dispatchOpenSettings("assistant");
              }}
            >
              Settings
            </button>
            <button type="button" className="btn small ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        {!enabled && !statusQuery.isLoading ? (
          <p className="assistant-panel__banner">
            {statusQuery.data?.keyMode === "user_only" ? (
              <>Add your own provider key in Assistant settings. An Administrator must also enable a chat provider. See </>
            ) : statusQuery.data?.keyMode === "user_preferred_instance_fallback" ? (
              <>
                Add your own provider key in Assistant settings, or ask an Administrator to store an instance key. A chat
                provider must be enabled. See{" "}
              </>
            ) : (
              <>
                Set an instance key under Administration → System properties, or set <code>OPENAI_API_KEY</code> in the
                server <code>.env</code> (deprecated fallback) and enable the OpenAI provider. See{" "}
              </>
            )}
            <button
              type="button"
              className="linkish"
              onClick={() => {
                onClose();
                dispatchOpenSettings("assistant");
              }}
            >
              Assistant settings
            </button>
            .
          </p>
        ) : null}

        {attachTarget ? (
          <div className="assistant-attach">
            <button
              type="button"
              className={`assistant-attach__chip${attachEnabled ? " is-on" : ""}`}
              onClick={() => setAttachEnabled((v) => !v)}
              title={
                attachEnabled
                  ? "Attached — click to detach for the next message"
                  : "Detached — click to include this page in the next message"
              }
            >
              {attachEnabled ? "Attached" : "Attach"}: {attachTarget.label}
            </button>
          </div>
        ) : null}

        <div className="assistant-panel__messages" ref={listRef}>
          {turns.length === 0 && !streaming && proposals.length === 0 ? (
            <p className="muted">
              Ask to search, summarize, research a URL, or draft changes. Suggested creates/edits
              appear below as review cards — nothing is saved until you click Apply.
            </p>
          ) : null}
          {turns.map((t, i) => (
            <div
              key={`${t.role}-${i}`}
              className={`assistant-bubble assistant-bubble--${t.role}`}
            >
              <div className="assistant-bubble__role">{t.role === "user" ? "You" : "Assistant"}</div>
              <div className="assistant-bubble__body">
                {t.content}
                {t.role === "assistant" && t.auditId != null ? (
                  <div className="assistant-feedback">
                    <button
                      type="button"
                      className={`assistant-feedback__thumb${t.feedback === "thumb_up" ? " is-on" : ""}`}
                      aria-pressed={t.feedback === "thumb_up"}
                      aria-label="Thumbs up"
                      onClick={() => void rateTurn(i, "thumb_up")}
                    >
                      <ThumbIcon />
                    </button>
                    <button
                      type="button"
                      className={`assistant-feedback__thumb${t.feedback === "thumb_down" ? " is-on" : ""}`}
                      aria-pressed={t.feedback === "thumb_down"}
                      aria-label="Thumbs down"
                      onClick={() => void rateTurn(i, "thumb_down")}
                    >
                      <ThumbIcon down />
                    </button>
                  </div>
                ) : null}
              </div>
              {t.role === "assistant" && t.auditId != null && t.feedback ? (
                <input
                  className="assistant-feedback__note"
                  type="text"
                  maxLength={500}
                  placeholder="Optional note"
                  aria-label="Optional note"
                  value={t.feedbackNote ?? ""}
                  onChange={(e) => {
                    const next = e.target.value;
                    setTurns((list) =>
                      list.map((item, idx) =>
                        idx === i ? { ...item, feedbackNote: next } : item,
                      ),
                    );
                  }}
                  onBlur={(e) => {
                    void saveTurnNote(i, e.target.value);
                  }}
                />
              ) : null}
            </div>
          ))}
          {toolNote && busy ? <p className="muted assistant-tool-note">{toolNote}</p> : null}
          {streaming ? (
            <div className="assistant-bubble assistant-bubble--assistant">
              <div className="assistant-bubble__role">Assistant</div>
              <div className="assistant-bubble__body">{streaming}</div>
            </div>
          ) : null}

          {tier3.length > 0 || tier2.length > 0 ? (
            <div className="assistant-proposals">
              <h3 className="assistant-proposals__title">Pending changes</h3>
              {tier3.length > 0 ? (
                <button type="button" className="btn small" onClick={() => setReviewOpen(true)}>
                  Review changes ({tier3.length})
                </button>
              ) : null}
              {tier2.length > 0 ? (
                <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                  Review each card, then Apply to write to TaskMesh (or Dismiss).
                </p>
              ) : null}
              {tier2.map((p) => (
                <AiProposalCard
                  key={p.id}
                  heading={proposalHeading(p)}
                  summary={p.summary}
                  fields={p.fields}
                  before={p.before}
                  notice={
                    proposalExpired(p)
                      ? "Expired — the target changed since this was proposed."
                      : undefined
                  }
                  applying={applyingId === p.id}
                  dismissing={dismissingId === p.id}
                  applyDisabled={proposalExpired(p) || applyingId != null}
                  dismissDisabled={applyingId === p.id || dismissingId === p.id}
                  onApply={() => applyMutation.mutate(p)}
                  onDismiss={() => void dismissProposal(p)}
                />
              ))}
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="assistant-panel__error" role="alert">
            {error}
          </p>
        ) : null}

        <form
          className="assistant-panel__form"
          onSubmit={(e) => {
            e.preventDefault();
            const msg = input.trim();
            if (!msg || busy || !enabled) return;
            setInput("");
            send.mutate(msg);
          }}
        >
          <textarea
            rows={3}
            value={input}
            disabled={!enabled || busy}
            placeholder={enabled ? "Message the assistant…" : "Configure OpenAI first"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const msg = input.trim();
                if (!msg || busy || !enabled) return;
                setInput("");
                send.mutate(msg);
              }
            }}
          />
          <div className="btn-row" style={{ justifyContent: "flex-end" }}>
            {busy ? (
              <button
                type="button"
                className="btn ghost small"
                onClick={() => abortRef.current?.abort()}
              >
                Stop
              </button>
            ) : null}
            <button type="submit" className="btn primary" disabled={!enabled || busy || !input.trim()}>
              {busy ? "Working…" : "Send"}
            </button>
          </div>
        </form>
      </aside>
      <AiReviewDialog
        open={reviewOpen && tier3.length > 0}
        proposals={tier3}
        applyingId={applyingId}
        rowErrors={rowErrors}
        onApproveSelected={(ids) => void approveSelected(ids)}
        onRejectAll={() => void rejectTier3()}
        onClose={closeReview}
      />
    </div>
  );
}
