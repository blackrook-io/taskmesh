import { applySpaClientHeaders } from "./client";

export type AssistantStatus = {
  enabled: boolean;
  provider: string;
  model: string;
  configuredProviders: { openai: boolean };
  toolsEnabled?: boolean;
};

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantProposal = {
  id: string;
  action: "create" | "update";
  entityType: "idea" | "document" | "task";
  entityId?: number;
  projectId?: number;
  summary: string;
  fields: Record<string, unknown>;
  method: "POST" | "PATCH";
  path: string;
};

export async function fetchAssistantStatus(): Promise<AssistantStatus> {
  const res = await fetch("/api/v1/assistant/status", { credentials: "include" });
  const json = (await res.json()) as { data?: AssistantStatus; error?: { message: string } };
  if (!res.ok) {
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
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onMeta?: (meta: { provider: string; model: string }) => void;
  onTool?: (info: { name: string; args: unknown }) => void;
  onProposal?: (proposal: AssistantProposal) => void;
}): Promise<void> {
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
      history: args.history,
      pageContext: args.pageContext ?? null,
    }),
    credentials: "include",
    signal: args.signal,
  });

  if (!res.ok) {
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
        } else if (eventName === "error") {
          throw new Error((data as { message?: string }).message ?? "Assistant error");
        } else if (eventName === "done") {
          return;
        }
        eventName = "message";
      }
    }
  }
}
