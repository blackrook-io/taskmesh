import { z } from "zod";

export type AiTier = 0 | 1 | 2 | 3;

const tierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

/** Administrator ceiling before the Tier 1 opt-in rule. */
export const DEFAULT_ACTION_TIERS: Record<string, AiTier> = {
  read: 0,
  web_fetch: 0,
  link: 1,
  tag: 1,
  comment: 1,
  propose_create: 2,
  propose_update: 2,
  apply: 2,
  propose_delete: 3,
  bulk: 3,
};

export const DEFAULT_BLAST_MAX_RECORDS = 5;
export const DEFAULT_BLAST_MAX_PROJECTS = 2;

export const AI_DELETE_DENY_REASON = "AI cannot execute deletes";

const REASSIGNMENT = "Reassignment requires full review";
const OTHER_USER = "Another user's record requires full review";
const CROSS_PROJECT = "Cross-project move requires full review";

export type StoredAiPermissionTiers = {
  matrix: Record<string, AiTier>;
  tier1Enabled: boolean;
  maxRecords: number;
  maxProjects: number;
};

export type AiPermissionSettings = StoredAiPermissionTiers & {
  tier1OptIn: boolean;
  userOverrides: Record<string, AiTier>;
};

export type TierOperation = {
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  projectId?: number | null;
  actorUserId: number;
  targetOwnerId?: number | null;
  fields?: Record<string, unknown> | null;
  /** Ignored. A caller-supplied tier never changes the result. */
  tier?: unknown;
};

export type ClassifiedOperation = {
  decision: "allow";
  tier: AiTier;
  reason: string;
  escalations: string[];
};

export type ChangePlan = {
  tier: AiTier;
  escalations: string[];
  operations: ClassifiedOperation[];
};

const storedSchema = z.object({
  matrix: z.record(z.string(), tierSchema),
  tier1Enabled: z.boolean(),
  maxRecords: z.number().int().positive(),
  maxProjects: z.number().int().positive(),
});

const MATRIX_KEY =
  /^(read|web_fetch|link|tag|comment|propose_create|propose_update|apply|propose_delete|bulk)(:(idea|project|task|document|todo|todo_list))?$/;

export function isAiMatrixKey(key: string): boolean {
  return MATRIX_KEY.test(key);
}

export function splitAiMatrixKey(key: string): { action: string; entityType: string | null } {
  const splitAt = key.indexOf(":");
  if (splitAt === -1) return { action: key, entityType: null };
  return { action: key.slice(0, splitAt), entityType: key.slice(splitAt + 1) };
}

/** Patch body for the Administrator matrix. Unknown actions and record types are rejected. */
export const aiPermissionTiersPatchSchema = z.object({
  matrix: z.record(z.string().regex(MATRIX_KEY), tierSchema),
  tier1Enabled: z.boolean(),
  maxRecords: z.number().int().positive().max(10_000),
  maxProjects: z.number().int().positive().max(10_000),
});

export function defaultStoredAiPermissionTiers(): StoredAiPermissionTiers {
  return {
    matrix: { ...DEFAULT_ACTION_TIERS },
    tier1Enabled: true,
    maxRecords: DEFAULT_BLAST_MAX_RECORDS,
    maxProjects: DEFAULT_BLAST_MAX_PROJECTS,
  };
}

export function defaultAiPermissionSettings(): AiPermissionSettings {
  return {
    ...defaultStoredAiPermissionTiers(),
    tier1OptIn: false,
    userOverrides: {},
  };
}

/** Invalid JSON falls back to the code defaults. A partial matrix keeps the other defaults. */
export function parseStoredAiPermissionTiers(value: unknown): StoredAiPermissionTiers {
  const parsed = storedSchema.safeParse(value);
  if (!parsed.success) return defaultStoredAiPermissionTiers();
  return {
    tier1Enabled: parsed.data.tier1Enabled,
    maxRecords: parsed.data.maxRecords,
    maxProjects: parsed.data.maxProjects,
    matrix: { ...DEFAULT_ACTION_TIERS, ...parsed.data.matrix },
  };
}

export function resolveAiPermissionSettings(
  stored: unknown,
  options?: { tier1OptIn?: boolean; userOverrides?: Record<string, AiTier> },
): AiPermissionSettings {
  const base = parseStoredAiPermissionTiers(stored);
  return {
    ...base,
    tier1OptIn: options?.tier1OptIn === true,
    userOverrides: options?.userOverrides ?? {},
  };
}

export function defaultActionTier(action: string): AiTier {
  return DEFAULT_ACTION_TIERS[action] ?? 3;
}

/** Administrator tier for one matrix key, including the code default. */
export function adminCeilingTier(
  matrix: Record<string, AiTier>,
  action: string,
  entityType?: string | null,
): AiTier {
  return lookupTier(matrix, action, entityType, true) ?? 3;
}

function lookupTier(
  matrix: Record<string, AiTier>,
  action: string,
  entityType: string | null | undefined,
  fallBackToDefaults: boolean,
): AiTier | undefined {
  if (entityType) {
    const specific = matrix[`${action}:${entityType}`];
    if (specific !== undefined) return specific;
  }
  if (matrix[action] !== undefined) return matrix[action];
  if (!fallBackToDefaults) return undefined;
  if (entityType && DEFAULT_ACTION_TIERS[`${action}:${entityType}`] !== undefined) {
    return DEFAULT_ACTION_TIERS[`${action}:${entityType}`];
  }
  return DEFAULT_ACTION_TIERS[action];
}

function hasField(fields: Record<string, unknown> | null | undefined, key: string): boolean {
  return !!fields && Object.prototype.hasOwnProperty.call(fields, key);
}

function integerField(fields: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!hasField(fields, key)) return null;
  const value = fields?.[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function classifyOperation(
  operation: TierOperation,
  settings: AiPermissionSettings = defaultAiPermissionSettings(),
): ClassifiedOperation {
  const known = lookupTier(settings.matrix, operation.action, operation.entityType, true);
  if (known === undefined) {
    return {
      decision: "allow",
      tier: 3,
      reason: "Unknown action",
      escalations: [],
    };
  }

  let tier: AiTier = known;
  let reason = "Allowed by the permission tier";
  if (tier === 1 && (!settings.tier1Enabled || !settings.tier1OptIn)) {
    tier = 2;
    reason = "Tier 1 applies only after the user opts in";
  }

  const userTier = lookupTier(settings.userOverrides, operation.action, operation.entityType, false);
  if (userTier !== undefined && userTier > tier) {
    tier = userTier;
    reason = "Raised by the user";
  }

  const escalations: string[] = [];
  if (hasField(operation.fields, "assigneeId") || hasField(operation.fields, "assignee")) {
    escalations.push(REASSIGNMENT);
  }
  if (
    typeof operation.targetOwnerId === "number" &&
    operation.targetOwnerId !== operation.actorUserId
  ) {
    escalations.push(OTHER_USER);
  }
  const nextProjectId = integerField(operation.fields, "projectId");
  if (
    nextProjectId != null &&
    typeof operation.projectId === "number" &&
    nextProjectId !== operation.projectId
  ) {
    escalations.push(CROSS_PROJECT);
  }
  if (escalations.length > 0) {
    tier = 3;
    reason = escalations.join("; ");
  }

  return { decision: "allow", tier, reason, escalations };
}

export function classifyChangePlan(
  operations: TierOperation[],
  settings: AiPermissionSettings = defaultAiPermissionSettings(),
): ChangePlan {
  const classified = operations.map((operation) => classifyOperation(operation, settings));
  if (classified.length === 0) {
    return { tier: 0, escalations: [], operations: [] };
  }

  let tier: AiTier = 0;
  for (const operation of classified) {
    if (operation.tier > tier) tier = operation.tier;
  }

  const escalations = classified.flatMap((operation) => operation.escalations);
  const recordKeys = new Set<string>();
  const projectIds = new Set<number>();
  operations.forEach((operation, index) => {
    if (operation.entityType && typeof operation.entityId === "number") {
      recordKeys.add(`${operation.entityType}:${operation.entityId}`);
    } else {
      recordKeys.add(`new:${index}`);
    }
    if (typeof operation.projectId === "number") projectIds.add(operation.projectId);
    const nextProjectId = integerField(operation.fields, "projectId");
    if (nextProjectId != null) projectIds.add(nextProjectId);
  });

  if (recordKeys.size > settings.maxRecords) {
    tier = 3;
    escalations.push(
      `Record count ${recordKeys.size} exceeds the limit of ${settings.maxRecords}`,
    );
  }
  if (projectIds.size > settings.maxProjects) {
    tier = 3;
    escalations.push(
      `Project count ${projectIds.size} exceeds the limit of ${settings.maxProjects}`,
    );
  }

  return { tier, escalations: unique(escalations), operations: classified };
}

export function operationFromProposal(
  proposal: {
    action: "create" | "update";
    policyAction?: "link" | "tag" | "comment";
    entityType: string;
    entityId?: number;
    projectId?: number;
    fields?: Record<string, unknown> | null;
    tier?: unknown;
  },
  actorUserId: number,
): TierOperation {
  const fields = { ...(proposal.fields ?? {}) };
  delete fields.tier;
  const action = proposal.policyAction
    ? proposal.policyAction
    : proposal.action === "create"
      ? "propose_create"
      : "propose_update";
  return {
    action,
    entityType: proposal.entityType,
    entityId: proposal.entityId ?? null,
    projectId: proposal.projectId ?? null,
    actorUserId,
    fields,
    tier: proposal.tier,
  };
}

export function isAiDeleteProposal(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const rec = body as Record<string, unknown>;
  if (typeof rec.method === "string" && rec.method.toUpperCase() === "DELETE") return true;
  if (typeof rec.action === "string") {
    const action = rec.action.toLowerCase();
    if (action === "delete" || action === "propose_delete") return true;
  }
  return false;
}
