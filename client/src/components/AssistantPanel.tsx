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
import { ConfirmDialog } from "./ConfirmDialog";

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
    return parsed.filter(
      (t) =>
        t &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string",
    ).slice(-40);
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

export function AssistantPanel({ open, onClose, pageContext }: Props) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>(() => loadTranscript());
  const [streaming, setStreaming] = useState("");
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<AssistantProposal | null>(null);
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
      if (e.key === "Escape" && !pendingProposal) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, pendingProposal]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, turns, streaming, toolNote]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    saveTranscript(turns);
  }, [turns]);

  const applyMutation = useMutation({
    mutationFn: async (p: AssistantProposal) => {
      await apiJson(p.patchPath, {
        method: "PATCH",
        body: JSON.stringify(p.fields),
      });
      return p;
    },
    onSuccess: (p) => {
      setPendingProposal(null);
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
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: `Applied update to ${p.entityType} #${p.entityId}: ${p.summary}`,
        },
      ]);
    },
    onError: (e: Error) => {
      setError(e.message);
      setPendingProposal(null);
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
            setPendingProposal(proposal);
          },
        });
        setTurns((t) => [...t, { role: "assistant", content: full || "(empty reply)" }]);
        setStreaming("");
        setToolNote(null);
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    onError: (e: Error) => {
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
              disabled={busy || turns.length === 0}
              onClick={() => {
                setTurns([]);
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
          {turns.length === 0 && !streaming ? (
            <p className="muted">
              Ask to search, summarize, or draft changes. Suggested edits appear as confirmations
              before anything is saved.
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

      <ConfirmDialog
        open={pendingProposal != null}
        title="Apply assistant change?"
        message={
          pendingProposal
            ? `${pendingProposal.summary}\n\n${pendingProposal.entityType} #${pendingProposal.entityId}${
                pendingProposal.projectId != null ? ` (project #${pendingProposal.projectId})` : ""
              }\nFields: ${Object.keys(pendingProposal.fields).join(", ") || "(none)"}`
            : ""
        }
        confirmLabel={applyMutation.isPending ? "Applying…" : "Apply"}
        onCancel={() => {
          if (!applyMutation.isPending) setPendingProposal(null);
        }}
        onConfirm={() => {
          if (pendingProposal && !applyMutation.isPending) {
            applyMutation.mutate(pendingProposal);
          }
        }}
      />
    </div>
  );
}
