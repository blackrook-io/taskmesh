import { apiJson } from "./client";
import type { CaptureConfirmBody, CaptureResult } from "../lib/quickCapture";

export async function proposeCapture(body: {
  text: string;
  projectId?: number;
  todoListId?: number;
  timeZone?: string;
}): Promise<CaptureResult> {
  const res = await apiJson<{ data: CaptureResult }>("/api/v1/ai/capture", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function confirmCapture(
  body: CaptureConfirmBody,
): Promise<{ entityType: string; id: number; ref: string; title: string; warnings: string[] }> {
  const res = await apiJson<{
    data: { entityType: string; id: number; ref: string; title: string; warnings: string[] };
  }>("/api/v1/ai/capture/confirm", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.data;
}
