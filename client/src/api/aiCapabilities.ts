import { apiJson } from "./client";

export type AiCapabilityReason =
  | "no_key"
  | "disabled_by_administrator"
  | "project_excluded"
  | "budget_reached";

export type AiCapability = {
  id: string;
  available: boolean;
  reason: AiCapabilityReason | null;
};

export async function fetchAiCapabilities(projectId: number | null): Promise<AiCapability[]> {
  const query = projectId != null ? `?projectId=${projectId}` : "";
  const res = await apiJson<{ data: AiCapability[] }>(`/api/v1/ai/capabilities${query}`);
  return res.data;
}

export function aiUnavailableTitle(reason: AiCapabilityReason | null): string {
  switch (reason) {
    case "no_key":
      return "AI needs a provider key.";
    case "disabled_by_administrator":
      return "AI is turned off by your Administrator.";
    case "project_excluded":
      return "This project is excluded from AI.";
    case "budget_reached":
      return "You have reached the AI usage budget.";
    default:
      return "AI is not available.";
  }
}
