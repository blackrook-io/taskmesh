import { apiJson, applySpaClientHeaders, maybeNotifySessionExpired } from "./client";

export type AiActivityRow = {
  id: number;
  action: string;
  summary: string;
  entityType: string | null;
  entityId: number | null;
  appliedAt: string;
  undoneAt: string | null;
  status: "applied" | "undone" | "skipped";
};

export type AiUndoResult =
  | { ok: true; status: "undone" | "skipped" }
  | { ok: false; code: string; message: string; change?: string; canForce?: boolean };

export async function fetchAiActivity(): Promise<{ windowDays: number; items: AiActivityRow[] }> {
  const res = await apiJson<{ data: { windowDays: number; items: AiActivityRow[] } }>(
    "/api/v1/ai/activity",
  );
  return res.data;
}

export async function patchTier1OptIn(
  optIn: boolean,
): Promise<{ optIn: boolean; tier1Enabled: boolean }> {
  const res = await apiJson<{ data: { optIn: boolean; tier1Enabled: boolean } }>(
    "/api/v1/assistant/tier1-opt-in",
    { method: "PATCH", body: JSON.stringify({ optIn }) },
  );
  return res.data;
}

export async function postAiUndo(
  id: number,
  body: { force?: boolean; skip?: boolean } = {},
): Promise<AiUndoResult> {
  const headers = new Headers({ "Content-Type": "application/json" });
  applySpaClientHeaders(headers);
  const res = await fetch(`/api/v1/ai/activity/${id}/undo`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    data?: { status?: "undone" | "skipped" };
    error?: { code?: string; message?: string; change?: string; canForce?: boolean };
  };
  if (res.ok && json.data?.status) return { ok: true, status: json.data.status };
  maybeNotifySessionExpired(`/api/v1/ai/activity/${id}/undo`, res.status);
  return {
    ok: false,
    code: json.error?.code ?? "undo_failed",
    message: json.error?.message ?? "Could not undo",
    ...(json.error?.change !== undefined ? { change: json.error.change } : {}),
    ...(json.error?.canForce !== undefined ? { canForce: json.error.canForce } : {}),
  };
}
