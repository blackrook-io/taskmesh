import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "../../db/schema.js";
import { writeAiAudit } from "./aiAudit.js";
import { aiFeatureNeeds } from "./aiFeatureRoutes.js";
import {
  AI_ACTIONS,
  AI_READ_ENTITY_TYPES,
  instancePolicyLayer,
  type AiAction,
} from "./aiPolicy.js";
import {
  adminCeilingTier,
  isAiMatrixKey,
  resolveAiPermissionSettings,
  splitAiMatrixKey,
  type AiPermissionSettings,
  type AiTier,
  type StoredAiPermissionTiers,
} from "./aiTiers.js";
import { getSystemProperties } from "../systemProperties.js";

type Db = NodePgDatabase<typeof schema>;

const tierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

const putSchema = z.object({
  raised: z.record(z.string(), tierSchema),
  off: z.array(z.string()),
  featuresOff: z.array(z.string()),
});

export type UserAiPolicy = {
  raised: Record<string, AiTier>;
  off: string[];
  featuresOff: string[];
};

export class UserAiPolicyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UserAiPolicyError";
  }
}

export function emptyUserAiPolicy(): UserAiPolicy {
  return { raised: {}, off: [], featuresOff: [] };
}

export function parseUserAiPolicy(value: unknown): UserAiPolicy {
  const parsed = putSchema.partial().safeParse(value ?? {});
  if (!parsed.success) return emptyUserAiPolicy();
  const raised: Record<string, AiTier> = {};
  for (const [key, tier] of Object.entries(parsed.data.raised ?? {})) {
    if (isAiMatrixKey(key) && tier !== undefined) raised[key] = tier;
  }
  return {
    raised,
    off: unique((parsed.data.off ?? []).filter(isAiMatrixKey)),
    featuresOff: unique((parsed.data.featuresOff ?? []).filter((id) => aiFeatureNeeds(id) != null)),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function cellLocked(action: AiAction, entityType: string | null, webFetchEnabled: boolean): boolean {
  return (
    instancePolicyLayer({
      actorUserId: 0,
      feature: "assistant",
      action,
      entityType: entityType as never,
      webFetchEnabled,
    }).decision === "deny"
  );
}

/** Matrix keys the user cannot turn on. The floor list is separate and is not included. */
export function lockedUserPolicyKeys(webFetchEnabled: boolean): string[] {
  const locked: string[] = [];
  for (const action of AI_ACTIONS) {
    const types = AI_READ_ENTITY_TYPES.map((entityType) => ({
      entityType,
      locked: cellLocked(action, entityType, webFetchEnabled),
    }));
    const defaultLocked =
      cellLocked(action, null, webFetchEnabled) && types.every((row) => row.locked);
    if (defaultLocked) locked.push(action);
    for (const row of types) {
      if (row.locked) locked.push(`${action}:${row.entityType}`);
    }
  }
  return locked;
}

/** Drops stored raises that do not actually raise the ceiling, including locked cells. */
export function effectiveRaised(
  policy: UserAiPolicy,
  ceiling: StoredAiPermissionTiers,
  locked: ReadonlySet<string>,
): Record<string, AiTier> {
  const raised: Record<string, AiTier> = {};
  for (const [key, tier] of Object.entries(policy.raised)) {
    if (locked.has(key)) continue;
    const { action, entityType } = splitAiMatrixKey(key);
    if (tier > adminCeilingTier(ceiling.matrix, action, entityType)) raised[key] = tier;
  }
  return raised;
}

export function validateUserAiPolicyPut(
  body: unknown,
  args: {
    ceiling: StoredAiPermissionTiers;
    locked: readonly string[];
    adminLockedFeatures: readonly string[];
  },
): UserAiPolicy {
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    throw new UserAiPolicyError(400, "validation_error", "AI policy is invalid.");
  }
  const locked = new Set(args.locked);
  const raised: Record<string, AiTier> = {};
  for (const [key, tier] of Object.entries(parsed.data.raised)) {
    if (!isAiMatrixKey(key)) {
      throw new UserAiPolicyError(400, "validation_error", "Unknown policy cell.");
    }
    if (locked.has(key)) {
      throw new UserAiPolicyError(400, "forbidden", "Disabled by your Administrator.");
    }
    const { action, entityType } = splitAiMatrixKey(key);
    const cap = adminCeilingTier(args.ceiling.matrix, action, entityType);
    if (tier < cap) {
      throw new UserAiPolicyError(400, "forbidden", "You can only raise a tier.");
    }
    if (tier > cap) raised[key] = tier;
  }
  const off: string[] = [];
  for (const key of parsed.data.off) {
    if (!isAiMatrixKey(key)) {
      throw new UserAiPolicyError(400, "validation_error", "Unknown policy cell.");
    }
    if (locked.has(key)) {
      throw new UserAiPolicyError(400, "forbidden", "Disabled by your Administrator.");
    }
    if (raised[key] !== undefined) {
      throw new UserAiPolicyError(400, "validation_error", "A cell cannot be raised and turned off.");
    }
    off.push(key);
  }
  const featuresOff: string[] = [];
  for (const id of parsed.data.featuresOff) {
    if (!aiFeatureNeeds(id)) {
      throw new UserAiPolicyError(400, "validation_error", "Unknown AI feature.");
    }
    featuresOff.push(id);
  }
  const normalizedOff = unique(featuresOff);
  for (const id of args.adminLockedFeatures) {
    if (!normalizedOff.includes(id)) {
      throw new UserAiPolicyError(400, "forbidden", "Disabled by your Administrator.");
    }
  }
  return { raised, off: unique(off), featuresOff: normalizedOff };
}

function signature(policy: UserAiPolicy): string {
  const raised = Object.fromEntries(
    Object.entries(policy.raised).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify({
    raised,
    off: [...policy.off].sort(),
    featuresOff: [...policy.featuresOff].sort(),
  });
}

function changeReason(before: UserAiPolicy, after: UserAiPolicy): string {
  const parts: string[] = [];
  if (signature({ ...before, off: [], featuresOff: [] }) !== signature({ ...after, off: [], featuresOff: [] })) {
    parts.push("raised");
  }
  if ([...before.off].sort().join() !== [...after.off].sort().join()) parts.push("off");
  if ([...before.featuresOff].sort().join() !== [...after.featuresOff].sort().join()) {
    parts.push("featuresOff");
  }
  return parts.length > 0 ? parts.join(", ") : "unchanged";
}

export async function loadUserAiPolicy(db: Db, userId: number): Promise<UserAiPolicy> {
  const loaded = await loadUserAiRow(db, userId);
  return loaded.policy;
}

async function loadUserAiRow(
  db: Db,
  userId: number,
): Promise<{ policy: UserAiPolicy; tier1OptIn: boolean }> {
  const [row] = await db
    .select({ aiPolicy: schema.users.aiPolicy, aiTier1OptIn: schema.users.aiTier1OptIn })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return {
    policy: parseUserAiPolicy(row?.aiPolicy),
    tier1OptIn: row?.aiTier1OptIn === true,
  };
}

export async function loadActorAiPermission(
  db: Db,
  userId: number,
): Promise<{ settings: AiPermissionSettings; off: string[]; policy: UserAiPolicy }> {
  const props = await getSystemProperties(db);
  const actor = await loadUserAiRow(db, userId);
  const locked = new Set(lockedUserPolicyKeys(props.aiWebFetch));
  return {
    policy: actor.policy,
    off: actor.policy.off,
    settings: resolveAiPermissionSettings(props.aiPermissionTiers, {
      tier1OptIn: actor.tier1OptIn,
      userOverrides: effectiveRaised(actor.policy, props.aiPermissionTiers, locked),
    }),
  };
}

export async function saveUserAiPolicy(
  db: Db,
  userId: number,
  body: unknown,
  args: { adminLockedFeatures: readonly string[] },
): Promise<UserAiPolicy> {
  const props = await getSystemProperties(db);
  const locked = lockedUserPolicyKeys(props.aiWebFetch);
  const next = validateUserAiPolicyPut(body, {
    ceiling: props.aiPermissionTiers,
    locked,
    adminLockedFeatures: args.adminLockedFeatures,
  });
  const before = await loadUserAiPolicy(db, userId);
  await db
    .update(schema.users)
    .set({ aiPolicy: next, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  await writeAiAudit({
    userId,
    feature: "user",
    action: "settings",
    decision: "allow",
    tier: 0,
    reason: changeReason(before, next),
  });
  return next;
}
