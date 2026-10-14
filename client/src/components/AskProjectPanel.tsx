import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { askProject, type ProjectAnswerCitation } from "../api/answer";
import { putAssistantFeedback } from "../api/assistant";
import { apiJson } from "../api/client";
import {
  citationRecordPath,
  linkCitedRefs,
  type CitationTarget,
} from "../lib/answerCitations";
import { isEntityType } from "../lib/entityType";
import type { TodoListDetail } from "../types";
import { MarkdownEditor } from "./shared/MarkdownEditor";

type AskTurn = {
  role: "user" | "assistant";
  content: string;
  citations?: CitationTarget[];
  auditId?: number | null;
  feedback?: "thumb_up" | "thumb_down";
  feedbackNote?: string;
};

type Props = {
  projectId: number;
  open: boolean;
  onClose: () => void;
};

export function AskProjectPanel({ projectId, open, onClose }: Props) {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    list.scrollTop = list.scrollHeight;
  }, [open, turns, pending]);

  async function submit() {
    const question = draft.trim();
    if (!question || pending) return;
    const history = turns.slice(-40).map((turn) => ({
      role: turn.role,
      content: turn.content.slice(0, 8_000),
    }));
    setDraft("");
    setError(null);
    setPending(true);
    setTurns((list) => [...list, { role: "user", content: question }]);
    try {
      const data = await askProject({ projectId, question, history });
      const citations = await citationLinks(projectId, data.citations);
      setTurns((list) => [
        ...list,
        {
          role: "assistant",
          content: data.answer,
          citations,
          auditId: data.auditId,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not answer");
    } finally {
      setPending(false);
    }
  }

  async function rateTurn(index: number, kind: "thumb_up" | "thumb_down") {
    const turn = turns[index];
    if (!turn || turn.auditId == null) return;
    const previous = turns;
    const note = turn.feedbackNote ?? "";
    setTurns((list) => list.map((item, i) => (i === index ? { ...item, feedback: kind } : item)));
    try {
      await putAssistantFeedback({
        auditId: turn.auditId,
        kind,
        note: note.trim() ? note : null,
      });
    } catch (err) {
      setTurns(previous);
      setError(err instanceof Error ? err.message : "Could not save feedback");
    }
  }

  async function saveTurnNote(index: number, note: string) {
    const turn = turns[index];
    if (!turn || turn.auditId == null || !turn.feedback) return;
    try {
      await putAssistantFeedback({
        auditId: turn.auditId,
        kind: turn.feedback,
        note: note.trim() ? note : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save feedback");
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="assistant-backdrop" onClick={onClose}>
      <aside
        className="assistant-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-project-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="assistant-panel__head">
          <div>
            <h2 id="ask-project-title">Ask</h2>
            <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>
              Answers use this project’s records.
            </p>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn small ghost"
              disabled={pending || turns.length === 0}
              onClick={() => {
                setTurns([]);
                setError(null);
              }}
            >
              Clear
            </button>
            <button type="button" className="btn small ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        {error ? (
          <p className="assistant-panel__banner" role="alert">
            {error}
          </p>
        ) : null}
        <div className="assistant-panel__messages" ref={listRef}>
          {turns.length === 0 && !pending ? (
            <p className="muted">Ask a question about this project. Citations open the record they came from.</p>
          ) : null}
          {turns.map((turn, index) => (
            <div key={`${turn.role}-${index}`} className={`assistant-bubble assistant-bubble--${turn.role}`}>
              <div className="assistant-bubble__role">{turn.role === "user" ? "You" : "Answer"}</div>
              {turn.role === "assistant" ? (
                <div className="assistant-bubble__body ask-answer">
                  <MarkdownEditor
                    value={linkCitedRefs(turn.content, turn.citations ?? [])}
                    onChange={() => undefined}
                    readOnly
                    autoHeight
                  />
                  {turn.citations && turn.citations.length > 0 ? (
                    <div className="ask-sources">
                      <p className="muted small">Records used</p>
                      <ul>
                        {turn.citations.map((citation) => (
                          <li key={`${citation.ref}-${citation.page ?? ""}`}>
                            <Link to={citation.href}>
                              {citation.ref}
                              {citation.page != null ? ` p.${citation.page}` : ""}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {turn.auditId != null ? (
                    <div className="assistant-feedback">
                      <button
                        type="button"
                        className={`assistant-feedback__thumb${turn.feedback === "thumb_up" ? " is-on" : ""}`}
                        aria-pressed={turn.feedback === "thumb_up"}
                        aria-label="Thumbs up"
                        onClick={() => void rateTurn(index, "thumb_up")}
                      >
                        <ThumbIcon />
                      </button>
                      <button
                        type="button"
                        className={`assistant-feedback__thumb${turn.feedback === "thumb_down" ? " is-on" : ""}`}
                        aria-pressed={turn.feedback === "thumb_down"}
                        aria-label="Thumbs down"
                        onClick={() => void rateTurn(index, "thumb_down")}
                      >
                        <ThumbIcon down />
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="assistant-bubble__body">{turn.content}</div>
              )}
              {turn.role === "assistant" && turn.auditId != null && turn.feedback ? (
                <input
                  className="assistant-feedback__note"
                  type="text"
                  maxLength={500}
                  placeholder="Optional note"
                  aria-label="Optional note"
                  value={turn.feedbackNote ?? ""}
                  onChange={(event) => {
                    const next = event.target.value;
                    setTurns((list) =>
                      list.map((item, i) => (i === index ? { ...item, feedbackNote: next } : item)),
                    );
                  }}
                  onBlur={(event) => {
                    void saveTurnNote(index, event.target.value);
                  }}
                />
              ) : null}
            </div>
          ))}
          {pending ? <p className="muted">Asking…</p> : null}
        </div>
        <form
          className="assistant-panel__form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <textarea
            ref={inputRef}
            rows={3}
            maxLength={2000}
            placeholder="Ask about this project"
            aria-label="Question"
            value={draft}
            disabled={pending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="btn-row" style={{ justifyContent: "flex-end" }}>
            <button type="submit" className="btn primary" disabled={pending || !draft.trim()}>
              {pending ? "Asking…" : "Ask"}
            </button>
          </div>
        </form>
      </aside>
    </div>,
    document.body,
  );
}

async function citationLinks(
  projectId: number,
  citations: ProjectAnswerCitation[],
): Promise<CitationTarget[]> {
  const links: CitationTarget[] = [];
  for (const citation of citations) {
    if (!isEntityType(citation.entityType)) continue;
    let href = citationRecordPath(projectId, citation);
    if (citation.entityType === "todo") {
      try {
        const listId = await findTodoListId(projectId, citation.entityId);
        href = citationRecordPath(projectId, citation, { todoListId: listId });
      } catch {
        href = citationRecordPath(projectId, citation);
      }
    }
    links.push({ ...citation, entityType: citation.entityType, href });
  }
  return links;
}

async function findTodoListId(projectId: number, todoId: number): Promise<number | null> {
  const lists = await apiJson<{ data: { id: number }[] }>(`/api/v1/todo-lists?projectId=${projectId}`);
  const details = await Promise.all(
    lists.data.map((list) => apiJson<{ data: TodoListDetail }>(`/api/v1/todo-lists/${list.id}`)),
  );
  for (const detail of details) {
    const items = detail.data.items;
    const match =
      Array.isArray(items) &&
      items.some((item) => item.entityType === "todo" && item.entityId === todoId);
    if (match) return detail.data.id;
  }
  return null;
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
