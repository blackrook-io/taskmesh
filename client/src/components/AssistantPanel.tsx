import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchAssistantStatus,
  streamAssistantChat,
  type AssistantProposal,
  type ChatTurn,
} from "../api/assistant";
import { apiJson } from "../api/client";

const TRANSCRIPT_KEY = "taskmesh.assistant.transcript";

type Props = {
  open: boolean;
  onClose: () => void;
  pageContext?: string | null;
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

function previewFields(fields: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const raw = v == null ? "∅" : typeof v === "string" ? v : JSON.stringify(v);
    const clipped = raw.length > 280 ? `${raw.slice(0, 280)}…` : raw;
    lines.push(`${k}: ${clipped}`);
  }
  return lines.join("\n") || "(no fields)";
}

export function AssistantPanel({ open, onClose, pageContext }: Props) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>(() => loadTranscript());
  const [streaming, setStreaming] = useState("");
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<AssistantProposal[]>([]);
  const [applyingId, setApplyingId] = useState<string | null>(null);
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
      await apiJson(p.path, {
        method: p.method,
        body: JSON.stringify(p.fields),
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
    onError: (e: Error) => {
      setApplyingId(null);
      setError(e.message);
    },
  });

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
          onTool: (info) => {
            setToolNote(`Using ${info.name}…`);
          },
          onProposal: (proposal) => {
            setProposals((list) => {
              if (list.some((x) => x.id === proposal.id)) return list;
              return [...list, proposal];
            });
          },
        });
        if (!ac.signal.aborted) {
          setTurns((t) => [
            ...t,
            { role: "assistant", content: full.trim() || "(empty reply)" },
          ]);
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
          {turns.length === 0 && !streaming && proposals.length === 0 ? (
            <p className="muted">
              Ask to search, summarize, or draft changes. Suggested creates/edits appear below as
              review cards — nothing is saved until you click Apply.
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
          {toolNote && busy ? <p className="muted assistant-tool-note">{toolNote}</p> : null}
          {streaming ? (
            <div className="assistant-bubble assistant-bubble--assistant">
              <div className="assistant-bubble__role">Assistant</div>
              <div className="assistant-bubble__body">{streaming}</div>
            </div>
          ) : null}

          {proposals.length > 0 ? (
            <div className="assistant-proposals">
              <h3 className="assistant-proposals__title">Pending changes</h3>
              <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                Review each card, then Apply to write to TaskMesh (or Dismiss).
              </p>
              {proposals.map((p) => (
                <article key={p.id} className="assistant-proposal-card">
                  <header className="assistant-proposal-card__head">
                    <strong>
                      {p.action === "create" ? "Create" : "Update"} {p.entityType}
                      {p.entityId != null ? ` #${p.entityId}` : ""}
                      {p.projectId != null ? ` · project #${p.projectId}` : ""}
                    </strong>
                  </header>
                  <p className="assistant-proposal-card__summary">{p.summary}</p>
                  <pre className="assistant-proposal-card__fields">{previewFields(p.fields)}</pre>
                  <div className="btn-row" style={{ marginTop: "0.5rem" }}>
                    <button
                      type="button"
                      className="btn small ghost"
                      disabled={applyingId === p.id}
                      onClick={() => setProposals((list) => list.filter((x) => x.id !== p.id))}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={applyingId != null}
                      onClick={() => applyMutation.mutate(p)}
                    >
                      {applyingId === p.id ? "Applying…" : "Apply"}
                    </button>
                  </div>
                </article>
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
    </div>
  );
}
