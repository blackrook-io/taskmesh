import { apiJson } from "./client";
import type { AiTier } from "../lib/aiPolicyMatrix";

export type UserAiCredential = {
  pluginId: string;
  keyHint: string | null;
  defaultModel: string | null;
  verifiedAt: string | null;
  lastError: string | null;
};

export type AiRoutingModel = {
  pluginId: string;
  model: string;
  local: boolean;
  tools: boolean;
  embeddings: boolean;
  longContext: boolean;
  size: "small" | "large";
};

export type AiRoutingFeature = {
  id: string;
  needs: {
    tools: boolean;
    longContext: boolean;
    embeddings: boolean;
    localOnly: boolean;
    size: "small" | "large";
  };
  preference: { pluginId: string; model: string } | null;
  adminDefault: { pluginId: string; model: string } | null;
  eligible: AiRoutingModel[];
};

export type UserAiPolicyFeature = {
  id: string;
  available: boolean;
  reason: string | null;
  enabled: boolean;
  locked: boolean;
};

export type UserAiPolicyView = {
  raised: Record<string, AiTier>;
  off: string[];
  featuresOff: string[];
  allowInventTags: boolean;
  ceiling: {
    matrix: Record<string, AiTier>;
    tier1Enabled: boolean;
    maxRecords: number;
    maxProjects: number;
  };
  locked: string[];
  webFetchEnabled: boolean;
  features: UserAiPolicyFeature[];
};

export function fetchUserAiCredentials(): Promise<UserAiCredential[]> {
  return apiJson<{ data: UserAiCredential[] }>("/api/v1/ai/credentials").then((res) => res.data);
}

export function putUserAiCredential(
  pluginId: string,
  body: { apiKey: string; defaultModel?: string | null },
): Promise<UserAiCredential> {
  return apiJson<{ data: UserAiCredential }>(`/api/v1/ai/credentials/${pluginId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  }).then((res) => res.data);
}

export function deleteUserAiCredential(pluginId: string): Promise<UserAiCredential | null> {
  return apiJson<{ data: UserAiCredential | null }>(`/api/v1/ai/credentials/${pluginId}`, {
    method: "DELETE",
  }).then((res) => res.data);
}

export function fetchAiRouting(): Promise<{ features: AiRoutingFeature[] }> {
  return apiJson<{ data: { features: AiRoutingFeature[] } }>("/api/v1/ai/routing").then((res) => res.data);
}

export function putAiRoute(
  feature: string,
  pin: { pluginId: string; model: string } | null,
): Promise<void> {
  return apiJson(`/api/v1/ai/routing/${feature}`, {
    method: "PUT",
    body: JSON.stringify(
      pin ? { pluginId: pin.pluginId, model: pin.model } : { pluginId: null, model: null },
    ),
  }).then(() => undefined);
}

export function fetchUserAiPolicy(): Promise<UserAiPolicyView> {
  return apiJson<{ data: UserAiPolicyView }>("/api/v1/ai/policy").then((res) => res.data);
}

export function putUserAiPolicy(body: {
  raised: Record<string, AiTier>;
  off: string[];
  featuresOff: string[];
  allowInventTags: boolean;
}): Promise<UserAiPolicyView> {
  return apiJson<{ data: UserAiPolicyView }>("/api/v1/ai/policy", {
    method: "PUT",
    body: JSON.stringify(body),
  }).then((res) => res.data);
}

export function recommendedRoute(feature: AiRoutingFeature): AiRoutingModel | null {
  return feature.eligible.find((row) => row.size === feature.needs.size) ?? feature.eligible[0] ?? null;
}
