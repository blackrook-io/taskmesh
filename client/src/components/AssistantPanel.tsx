import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchAssistantStatus,
  streamAssistantChat,
  type ChatTurn,
} from "../api/assistant";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Optional context from the current page (idea/doc/project summary). */
  pageContext?: string | null;
};

export function AssistantPanel({ open, onClose, pageContext }: Props) {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, turns, streaming]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const send = useMutation({
    mutationFn: async (message: string) => {
      setError(null);
      setBusy(true);
      setStreaming("");
      const history = turns;
      setTurns((t) => [...t, { role: "user", content: message }]);
      const ac = new AbortController();
      abortRef.current = ac;
      let full = "";
      try {
        await streamAssistantChat({
          message,
          history,
          pageContext,
          signal: ac.signal,
          onDelta: (text) => {
            full += text;
            setStreaming(full);
          },
        });
        setTurns((t) => [...t, { role: "assistant", content: full || "(empty reply)" }]);
        setStreaming("");
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    onError: (e: Error) => {
      setError(e.message);
      setStreaming("");
      setBusy(false);
    },
  });

  if (!open) return null;

  const enabled = statusQuery.data?.enabled ?? false;

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
            <Link to="/settings/assistant" className="btn small ghost" onClick={onClose}>
              Settings
            </Link>
            <button type="button" className="btn small ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        {!enabled && !statusQuery.isLoading ? (
          <p className="assistant-panel__banner">
            Set <code>OPENAI_API_KEY</code> in the server <code>.env</code> and restart TaskMesh. See{" "}
            <Link to="/settings/assistant" onClick={onClose}>
              Assistant settings
            </Link>
            .
          </p>
        ) : null}

        <div className="assistant-panel__messages" ref={listRef}>
          {turns.length === 0 && !streaming ? (
            <p className="muted">
              Ask for research help, drafts, or summaries. Optional page context is attached when
              available. Edits to records come in a later phase (confirm before apply).
            </p>
          ) : null}
          {turns.map((t, i) => (
            <div
              key={`${t.role}-${i}`}
              className={`assistant-bubble assistant-bubble--${t.role}`}
            >
              <div className="assistant-bubble__role">{t.role === "user" ? "You" : "Assistant"}</div>
              <div className="assistant-bubble__body">{t.content}</div>
            </div>
          ))}
          {streaming ? (
            <div className="assistant-bubble assistant-bubble--assistant">
              <div className="assistant-bubble__role">Assistant</div>
              <div className="assistant-bubble__body">{streaming}</div>
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
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
