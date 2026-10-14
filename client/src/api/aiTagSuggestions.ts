import { apiJson } from "./client";
import type { EntityType } from "../lib/entityType";

export type AiTagSuggestion = {
  id: number;
  name: string;
  confidence: number;
  invented: boolean;
};

export type AiTagSuggestionList = {
  suggestions: AiTagSuggestion[];
  undo: { journalId: number; summary: string } | null;
};

export function fetchAiTagSuggestions(
  entityType: EntityType,
  entityId: number,
): Promise<AiTagSuggestionList> {
  const params = new URLSearchParams({ entityType, entityId: String(entityId) });
  return apiJson<{ data: AiTagSuggestionList }>(`/api/v1/ai/tag-suggestions?${params}`).then(
    (res) => res.data,
  );
}

export function acceptAiTagSuggestion(id: number): Promise<{ id: number; name: string }> {
  return apiJson<{ data: { id: number; name: string } }>(`/api/v1/ai/tag-suggestions/${id}/accept`, {
    method: "POST",
  }).then((res) => res.data);
}

export function dismissAiTagSuggestion(id: number): Promise<void> {
  return apiJson(`/api/v1/ai/tag-suggestions/${id}/dismiss`, { method: "POST" }).then(() => undefined);
}
