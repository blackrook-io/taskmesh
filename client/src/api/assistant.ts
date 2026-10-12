import { apiJson, applySpaClientHeaders, maybeNotifySessionExpired } from "./client";

export type AssistantPluginStatus = {
  id: string;
  displayName: string;
  enabled: boolean;
  configured: boolean;
  capabilities: {
    chat: boolean;
    streaming: boolean;
    tools: boolean;
    embeddings: boolean;
    local: boolean;
  };
};

export type AssistantStatus = {
  enabled: boolean;
  provider: string;
  model: string;
  keyMode?: "instance_only" | "user_only" | "user_preferred_instance_fallback";
  configuredProviders: { openai: boolean };
  plugins?: AssistantPluginStatus[];
  toolsEnabled?: boolean;
  tier1OptIn?: boolean;
  tier1Enabled?: boolean;
};

export type AiFeedbackKind = "thumb_up" | "thumb_down" | "accept" | "dismiss" | "undo";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  /** Present on assistant replies that were audited. */
  auditId?: number;
  feedback?: "thumb_up" | "thumb_down";
  feedbackNote?: string;
};

export type AssistantProposal = {
  id: string;
  action: "create" | "update";
  policyAction?: "link" | "tag" | "comment";
  entityType: "idea" | "project" | "document" | "task" | "todo" | "todo_list";
  entityId?: number;
  projectId?: number;
  summary: string;
  fields: Record<string, unknown>;
  method: "POST" | "PATCH";
  path: string;
  tier?: number;
  auditId?: number;
  before?: Record<string, unknown>;
  baseUpdatedAt?: string;
  targetMissing?: boolean;
  /** Set by the panel from the turn's done event. */
  planTier?: number;
  planEscalations?: string[];
  stale?: boolean;
};

export async function fetchAssistantStatus(): Promise<AssistantStatus> {
  const res = await fetch("/api/v1/assistant/status", { credentials: "include" });
  const json = (await res.json()) as { data?: AssistantStatus; error?: { message: string } };
  if (!res.ok) {
    maybeNotifySessionExpired("/api/v1/assistant/status", res.status);
    throw new Error(json.error?.message ?? "Failed to load assistant status");
  }
  if (!json.data) throw new Error("Missing assistant status");
  return json.data;
}

/**
 * Stream a chat reply via SSE. Calls onDelta for each text chunk; resolves on done.
 */
export async function streamAssistantChat(args: {
  message: string;
  history: ChatTurn[];
  pageContext?: string | null;
  projectId?: number | null;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onMeta?: (meta: { provider: string; model: string }) => void;
  onTool?: (info: { name: string; args: unknown }) => void;
  onProposal?: (proposal: AssistantProposal) => void;
  onApplied?: (applied: { journalId: number; summary: string }) => void;
  onApplyFailed?: (failed: { summary: string; message: string }) => void;
}): Promise<{ auditId: number | null; planTier: number | null; planEscalations: string[] }> {
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  });
  applySpaClientHeaders(headers);
  const res = await fetch("/api/v1/assistant/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: args.message,
      history: args.history.map((turn) => ({ role: turn.role, content: turn.content })),
      pageContext: args.pageContext ?? null,
      ...(args.projectId != null ? { projectId: args.projectId } : {}),
    }),
    credentials: "include",
    signal: args.signal,
  });

  if (!res.ok) {
    maybeNotifySessionExpired("/api/v1/assistant/chat", res.status);
    let message = res.statusText;
    try {
      const text = await res.text();
      const trimmed = text.trimStart();
      if (trimmed.startsWith("<")) {
        message = `Assistant HTTP ${res.status}: server returned HTML (is the API up?)`;
      } else {
        const j = JSON.parse(text) as { error?: { message?: string } };
        if (j.error?.message) message = j.error.message;
      }
    } catch {
      /* keep statusText */
    }
    throw new Error(message);
  }

  if (!res.body) throw new Error("No response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let auditId: number | null = null;
  let planTier: number | null = null;
  let planEscalations: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        const raw = line.slice(5).trim();
        if (!raw) continue;
        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          continue;
        }
        if (eventName === "delta") {
          const text = (data as { text?: string }).text;
          if (text) args.onDelta(text);
        } else if (eventName === "meta") {
          args.onMeta?.(data as { provider: string; model: string });
        } else if (eventName === "tool") {
          args.onTool?.(data as { name: string; args: unknown });
        } else if (eventName === "proposal") {
          args.onProposal?.(data as AssistantProposal);
        } else if (eventName === "applied") {
          const applied = data as { journalId?: unknown; summary?: unknown };
          if (typeof applied.journalId === "number" && typeof applied.summary === "string") {
            args.onApplied?.({ journalId: applied.journalId, summary: applied.summary });
          }
        } else if (eventName === "apply_failed") {
          const failed = data as { summary?: unknown; message?: unknown };
          args.onApplyFailed?.({
            summary: typeof failed.summary === "string" ? failed.summary : "Change",
            message: typeof failed.message === "string" ? failed.message : "Could not apply",
          });
        } else if (eventName === "error") {
          throw new Error((data as { message?: string }).message ?? "Assistant error");
        } else if (eventName === "done") {
          const payload = data as { auditId?: unknown; planTier?: unknown; planEscalations?: unknown };
          const id = payload.auditId;
          auditId = typeof id === "number" ? id : null;
          planTier = typeof payload.planTier === "number" ? payload.planTier : null;
          planEscalations = Array.isArray(payload.planEscalations)
            ? payload.planEscalations.filter((line): line is string => typeof line === "string")
            : [];
          return { auditId, planTier, planEscalations };
        }
        eventName = "message";
      }
    }
  }
  return { auditId, planTier, planEscalations };
}

export async function putAssistantFeedback(input: {
  auditId: number;
  kind: AiFeedbackKind;
  note?: string | null;
}): Promise<void> {
  await apiJson("/api/v1/assistant/feedback", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
