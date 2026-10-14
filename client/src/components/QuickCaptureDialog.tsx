import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { confirmCapture, proposeCapture } from "../api/capture";
import { projectIdFromPath } from "../lib/useAssistantAvailability";
import {
  addTag,
  applyChoice,
  browserTimeZone,
  captureRecordHref,
  clearRef,
  confirmBodyOf,
  draftFromCapture,
  errorDraft,
  isConfirmable,
  leaveQuestion,
  listIdFromPath,
  removeLink,
  removeTag,
  setRecordType,
  setTitle,
  splitCaptureLines,
  type CaptureDraft,
  type CapturePriority,
  type CaptureRecordType,
} from "../lib/quickCapture";

const RECORD_LABEL: Record<CaptureRecordType, string> = {
  task: "Task",
  todo: "ToDo",
  idea: "Idea",
};

const PRIORITIES: CapturePriority[] = ["none", "low", "medium", "high", "urgent"];

type Props = {
  open: boolean;
  onClose: () => void;
};

export function QuickCaptureDialog({ open, onClose }: Props) {
  if (!open) return null;
  return <QuickCaptureBody onClose={onClose} />;
}

function QuickCaptureBody({ onClose }: { onClose: () => void }) {
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const titleId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [text, setText] = useState("");
  const [cards, setCards] = useState<CaptureDraft[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const savingRef = useRef(new Set<string>());
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => textRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      previouslyFocused.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const root = rootRef.current;
      if (!root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>("input, textarea, select, a[href], button:not([disabled])")];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function patch(key: string, next: CaptureDraft) {
    setCards((prev) => prev.map((card) => (card.key === key ? next : card)));
    setSaveErrors((prev) => {
      if (!prev[key]) return prev;
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  }

  async function readLines() {
    const split = splitCaptureLines(text);
    if (split.lines.length === 0 || reading) return;
    setText(split.remainder);
    setNotice(
      split.remainder.length > 0
        ? "Only the first 10 lines were read. The rest stayed in the box."
        : null,
    );
    setReading(true);
    const projectId = projectIdFromPath(pathname);
    const todoListId = listIdFromPath(pathname);
    const timeZone = browserTimeZone();
    for (const line of split.lines) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const data = await proposeCapture({
          text: line,
          timeZone,
          ...(projectId != null ? { projectId } : {}),
          ...(todoListId != null ? { todoListId } : {}),
        });
        setCards((prev) => [...prev, draftFromCapture(line, data, key)]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not read that line.";
        setCards((prev) => [...prev, errorDraft(line, message, key)]);
      }
    }
    setReading(false);
  }

  async function confirmOne(draft: CaptureDraft) {
    const body = confirmBodyOf(draft);
    if (!body || savingRef.current.has(draft.key)) return;
    savingRef.current.add(draft.key);
    setSaving(new Set(savingRef.current));
    setSaveErrors((prev) => {
      if (!prev[draft.key]) return prev;
      const copy = { ...prev };
      delete copy[draft.key];
      return copy;
    });
    try {
      const saved = await confirmCapture(body);
      const href = captureRecordHref(body.recordType, saved.id, body.projectId, body.listId);
      setCards((prev) =>
        prev.map((card) =>
          card.key === draft.key
            ? {
                ...card,
                warnings: saved.warnings,
                saved: {
                  entityType: body.recordType,
                  id: saved.id,
                  ref: saved.ref,
                  href,
                },
              }
            : card,
        ),
      );
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["todos"] });
      void qc.invalidateQueries({ queryKey: ["ideas"] });
      void qc.invalidateQueries({ queryKey: ["todo-list"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save that record.";
      setSaveErrors((prev) => ({ ...prev, [draft.key]: message }));
    } finally {
      savingRef.current.delete(draft.key);
      setSaving(new Set(savingRef.current));
    }
  }

  async function confirmReady() {
    for (const card of cards) {
      if (isConfirmable(card)) await confirmOne(card);
    }
  }

  const readyCount = cards.filter((card) => isConfirmable(card)).length;

  return (
    <div
      className="quick-capture-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={rootRef}
        className="quick-capture"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="quick-capture__head">
          <h2 id={titleId}>Quick capture</h2>
          <button type="button" className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="quick-capture__compose">
          <label className="field">
            <span className="field-label">What should be captured?</span>
            <textarea
              ref={textRef}
              rows={3}
              value={text}
              placeholder="ToDo: book the exam slot by Friday, urgent, AWS project"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void readLines();
                }
              }}
            />
          </label>
          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              disabled={reading || text.trim().length === 0}
              onClick={() => void readLines()}
            >
              {reading ? "Reading…" : "Read"}
            </button>
            {readyCount > 0 ? (
              <button
                type="button"
                className="btn"
                disabled={reading || saving.size > 0}
                onClick={() => void confirmReady()}
              >
                Confirm ready ({readyCount})
              </button>
            ) : null}
          </div>
          {notice ? <p className="quick-capture__notice">{notice}</p> : null}
        </div>
        <div className="quick-capture__cards">
          {cards.map((card) => (
            <CaptureCard
              key={card.key}
              card={card}
              saving={saving.has(card.key)}
              saveError={saveErrors[card.key] ?? null}
              onChange={(next) => patch(card.key, next)}
              onDismiss={() => setCards((prev) => prev.filter((item) => item.key !== card.key))}
              onConfirm={() => void confirmOne(card)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CaptureCard({
  card,
  saving,
  saveError,
  onChange,
  onDismiss,
  onConfirm,
}: {
  card: CaptureDraft;
  saving: boolean;
  saveError: string | null;
  onChange: (next: CaptureDraft) => void;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const [tag, setTag] = useState("");
  const confirmable = isConfirmable(card);

  return (
    <article className="quick-capture__card">
      <p className="quick-capture__source">{card.source}</p>
      {card.error ? (
        <p className="quick-capture__error" role="alert">
          {card.error}
        </p>
      ) : null}
      {card.saved ? (
        <p className="quick-capture__saved">
          Created{" "}
          <Link to={card.saved.href}>
            {card.saved.ref}
          </Link>
        </p>
      ) : null}
      {card.warnings.map((warning) => (
        <p key={warning} className="quick-capture__notice">
          {warning}
        </p>
      ))}
      {!card.error && !card.saved ? (
        <div className="quick-capture__grid">
          <label className="field">
            <span className="field-label">Type</span>
            <select
              value={card.recordType ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "task" || value === "todo" || value === "idea") {
                  onChange(setRecordType(card, value));
                }
              }}
            >
              <option value="">Choose</option>
              <option value="task">Task</option>
              <option value="todo">ToDo</option>
              <option value="idea">Idea</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Priority</span>
            <select
              value={card.priority}
              disabled={card.recordType === "idea"}
              onChange={(event) =>
                onChange({
                  ...card,
                  denied: null,
                  priority: event.target.value as CapturePriority | "",
                  questions: card.questions.filter((question) => question.field !== "priority"),
                })
              }
            >
              <option value="">Not set</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>
          <label className="field quick-capture__span">
            <span className="field-label">Title</span>
            <input value={card.title} onChange={(event) => onChange(setTitle(card, event.target.value))} />
          </label>
          <label className="field quick-capture__span">
            <span className="field-label">Description</span>
            <textarea
              rows={2}
              value={card.description}
              onChange={(event) =>
                onChange({
                  ...card,
                  denied: null,
                  description: event.target.value,
                  questions: card.questions.filter((question) => question.field !== "description"),
                })
              }
            />
          </label>
          <label className="field">
            <span className="field-label">Due date</span>
            <input
              type="date"
              value={card.dueDate}
              disabled={card.recordType === "idea"}
              onChange={(event) =>
                onChange({
                  ...card,
                  denied: null,
                  dueDate: event.target.value,
                  questions: card.questions.filter((question) => question.field !== "dueDate"),
                })
              }
            />
          </label>
          <RefField label="Project" value={card.project} hidden={card.recordType === "idea"} onClear={() => onChange(clearRef(card, "project"))} />
          <RefField label="List" value={card.list} hidden={card.recordType !== "todo"} onClear={() => onChange(clearRef(card, "list"))} />
          <RefField label="Parent" value={card.parent} hidden={card.recordType !== "task"} onClear={() => onChange(clearRef(card, "parent"))} />
          <div className="field quick-capture__span">
            <span className="field-label">Tags</span>
            <div className="quick-capture__chips">
              {card.tags.map((name) => (
                <button key={name} type="button" className="btn small ghost" onClick={() => onChange(removeTag(card, name))}>
                  {name} ×
                </button>
              ))}
              <input
                value={tag}
                aria-label="Add tag"
                placeholder="Add tag"
                onChange={(event) => setTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  onChange(addTag(card, tag));
                  setTag("");
                }}
              />
            </div>
          </div>
          {card.links.length > 0 ? (
            <div className="field quick-capture__span">
              <span className="field-label">Links</span>
              <div className="quick-capture__chips">
                {card.links.map((link) => (
                  <button
                    key={`${link.entityType}-${link.id}`}
                    type="button"
                    className="btn small ghost"
                    onClick={() => onChange(removeLink(card, link.entityType, link.id))}
                  >
                    {link.ref} {link.title} ×
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {card.questions.map((question) => (
        <div key={question.field} className="quick-capture__question">
          <p>{question.prompt}</p>
          <div className="btn-row">
            {question.choices?.map((choice) => (
              <button
                key={choice.ref}
                type="button"
                className="btn small"
                onClick={() => onChange(applyChoice(card, question, choice))}
              >
                {choice.ref === choice.title ? choice.title : `${choice.ref} ${choice.title}`}
              </button>
            ))}
            {question.field !== "title" && question.field !== "recordType" ? (
              <button type="button" className="btn small ghost" onClick={() => onChange(leaveQuestion(card, question.field))}>
                Leave unset
              </button>
            ) : null}
          </div>
        </div>
      ))}
      {card.denied ? <p className="quick-capture__error">{card.denied}</p> : null}
      {saveError ? (
        <p className="quick-capture__error" role="alert">
          {saveError}
        </p>
      ) : null}
      <div className="btn-row">
        <button type="button" className="btn small ghost" disabled={saving} onClick={onDismiss}>
          Dismiss
        </button>
        {!card.saved && !card.error ? (
          <button type="button" className="btn small primary" disabled={!confirmable || saving} onClick={onConfirm}>
            {saving ? "Saving…" : card.recordType ? `Confirm ${RECORD_LABEL[card.recordType]}` : "Confirm"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function RefField({
  label,
  value,
  hidden,
  onClear,
}: {
  label: string;
  value: { ref: string; title: string } | null;
  hidden: boolean;
  onClear: () => void;
}) {
  if (hidden) return null;
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {value ? (
        <div className="quick-capture__chips">
          <span>
            {value.ref} {value.title}
          </span>
          <button type="button" className="btn small ghost" onClick={onClear}>
            Clear
          </button>
        </div>
      ) : (
        <p className="quick-capture__empty">None</p>
      )}
    </div>
  );
}
