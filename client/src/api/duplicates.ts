import { apiJson } from "./client";

export type DuplicateHit = {
  entityType: "task" | "todo";
  entityId: number;
  referenceId: string;
  title: string;
  href: string;
  score: number;
  reason: string;
};

export function fetchDuplicateCheck(args: {
  entityType: "task" | "todo";
  title: string;
  excludeId?: number;
  projectId?: number | null;
}): Promise<DuplicateHit[]> {
  const params = new URLSearchParams({ entityType: args.entityType, title: args.title });
  if (args.excludeId != null) params.set("excludeId", String(args.excludeId));
  if (args.projectId != null) params.set("projectId", String(args.projectId));
  return apiJson<{ data: { hits: DuplicateHit[] } }>(`/api/v1/ai/duplicate-check?${params}`).then(
    (res) => res.data.hits,
  );
}

export function fetchDuplicatePairs(
  entityType: "task" | "todo",
  entityId: number,
): Promise<DuplicateHit[]> {
  const params = new URLSearchParams({ entityType, entityId: String(entityId) });
  return apiJson<{ data: { hits: DuplicateHit[] } }>(`/api/v1/ai/duplicate-pairs?${params}`).then(
    (res) => res.data.hits,
  );
}

export function ignoreDuplicatePair(args: {
  entityType: "task" | "todo";
  entityId: number;
  matchType: "task" | "todo";
  matchId: number;
}): Promise<void> {
  return apiJson("/api/v1/ai/duplicate-pairs/ignore", {
    method: "POST",
    body: JSON.stringify(args),
  }).then(() => undefined);
}

export function linkDuplicatePair(args: {
  entityType: "task" | "todo";
  entityId: number;
  matchType: "task" | "todo";
  matchId: number;
}): Promise<void> {
  return apiJson("/api/v1/ai/duplicate-pairs/link", {
    method: "POST",
    body: JSON.stringify(args),
  }).then(() => undefined);
}
