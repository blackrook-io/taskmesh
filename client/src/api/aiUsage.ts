import { apiJson } from "./client";

export type UserAiUsage = {
  dayStart: string;
  tokensUsed: number;
  tokenLimit: number | null;
  instanceSpendMicroUsd: number | null;
  instanceSpendLimitMicroUsd: number | null;
  keySource: "user" | "instance" | "local" | null;
  warning: boolean;
  blocked: boolean;
};

export type AdminAiUsageRow = {
  userId: number | null;
  displayName: string | null;
  feature: string;
  provider: string | null;
  keySource: string | null;
  tokensIn: number;
  tokensOut: number;
  costMicrousd: number;
};

export type AdminAiUsage = {
  dayStart: string;
  rows: AdminAiUsageRow[];
  instanceSpendMicroUsd: number;
};

export function fetchUserAiUsage(): Promise<UserAiUsage> {
  return apiJson<{ data: UserAiUsage }>("/api/v1/ai/usage").then((res) => res.data);
}

export function fetchAdminAiUsage(): Promise<AdminAiUsage> {
  return apiJson<{ data: AdminAiUsage }>("/api/v1/admin/ai/usage").then((res) => res.data);
}

export function formatUsdFromMicro(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(2)}`;
}
