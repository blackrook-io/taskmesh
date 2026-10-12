export type ReviewGroup<T> = {
  projectId: number | null;
  label: string;
  items: T[];
};

export function isDeleteProposal(proposal: { action?: string; method?: string }): boolean {
  if (typeof proposal.method === "string" && proposal.method.toUpperCase() === "DELETE") return true;
  const action = proposal.action?.toLowerCase();
  return action === "delete" || action === "propose_delete";
}

export function proposalExpired(proposal: { targetMissing?: boolean; stale?: boolean }): boolean {
  return proposal.targetMissing === true || proposal.stale === true;
}

export function groupByProject<T extends { projectId?: number | null }>(items: readonly T[]): ReviewGroup<T>[] {
  const buckets = new Map<number | null, T[]>();
  for (const item of items) {
    const projectId = item.projectId ?? null;
    const list = buckets.get(projectId);
    if (list) list.push(item);
    else buckets.set(projectId, [item]);
  }
  return [...buckets.entries()]
    .sort((a, b) => {
      if (a[0] == null) return 1;
      if (b[0] == null) return -1;
      return a[0] - b[0];
    })
    .map(([projectId, groupItems]) => ({
      projectId,
      label: projectId == null ? "No project" : `Project #${projectId}`,
      items: groupItems,
    }));
}

export function formatFieldValue(value: unknown): string {
  if (value == null) return "∅";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export type DiffLine = {
  key: string;
  kind: "add" | "change";
  beforeText: string | null;
  afterText: string;
};

export function diffLines(
  fields: Record<string, unknown>,
  before?: Record<string, unknown> | null,
): DiffLine[] {
  return Object.entries(fields).map(([key, value]) => {
    const afterText = formatFieldValue(value);
    if (!before || !Object.prototype.hasOwnProperty.call(before, key)) {
      return { key, kind: "add", beforeText: null, afterText };
    }
    return { key, kind: "change", beforeText: formatFieldValue(before[key]), afterText };
  });
}

export function proposalHeading(proposal: {
  policyAction?: string;
  action: string;
  entityType: string;
  entityId?: number;
  projectId?: number | null;
}): string {
  const target = `${proposal.entityType}${proposal.entityId != null ? ` #${proposal.entityId}` : ""}`;
  if (proposal.policyAction === "link") return `Add link on ${target}`;
  if (proposal.policyAction === "tag") return `Add tag on ${target}`;
  if (proposal.policyAction === "comment") return `Add comment on ${target}`;
  const verb = proposal.action === "create" ? "Create" : proposal.action === "update" ? "Update" : "Change";
  const project = proposal.projectId != null ? ` · project #${proposal.projectId}` : "";
  return `${verb} ${target}${project}`;
}

export function uniqueEscalations(items: readonly { planEscalations?: string[] }[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of items) {
    for (const line of item.planEscalations ?? []) {
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}
