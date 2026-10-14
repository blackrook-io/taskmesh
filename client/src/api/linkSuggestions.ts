import { apiJson } from "./client";
import type { EntityType } from "../lib/entityType";

export type LinkSuggestionEnd = {
  entityType: EntityType;
  id: number;
  referenceId: string;
  title: string;
  href: string;
  projectId: number | null;
};

export type LinkSuggestion = {
  id: number;
  matchPercent: number;
  reason: string;
  source: LinkSuggestionEnd;
  target: LinkSuggestionEnd;
};

const SUBJECTS = new Set<EntityType>(["task", "todo", "idea", "document"]);

export function linkSuggestionsEnabled(entityType: EntityType): boolean {
  return SUBJECTS.has(entityType);
}

export function fetchLinkSuggestions(entityType: EntityType, entityId: number): Promise<LinkSuggestion[]> {
  const params = new URLSearchParams({ entityType, entityId: String(entityId) });
  return apiJson<{ data: { suggestions: LinkSuggestion[] } }>(
    `/api/v1/ai/link-suggestions?${params}`,
  ).then((res) => res.data.suggestions);
}

export function acceptLinkSuggestion(id: number): Promise<void> {
  return apiJson(`/api/v1/ai/link-suggestions/${id}/accept`, { method: "POST" }).then(() => undefined);
}

export function dismissLinkSuggestion(id: number): Promise<void> {
  return apiJson(`/api/v1/ai/link-suggestions/${id}/dismiss`, { method: "POST" }).then(() => undefined);
}
