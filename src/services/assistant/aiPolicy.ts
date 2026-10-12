import type { EntityType } from "../../lib/entityType.js";

export const AI_ACTIONS = [
  "read",
  "propose_create",
  "propose_update",
  "link",
  "tag",
  "comment",
  "apply",
  "propose_delete",
  "web_fetch",
  "bulk",
] as const;

export type AiAction = (typeof AI_ACTIONS)[number];

/** Resources the model can never touch. These are not domain entity types. */
export const FLOOR_RESOURCES = [
  "user",
  "role",
  "group",
  "api_key",
  "ai_credential",
  "backup",
  "ownership",
  "system_property",
  "ai_policy",
] as const;

export type FloorResource = (typeof FLOOR_RESOURCES)[number];

export type AiTier = 0 | 1 | 2 | 3;

export type PolicyDecision = {
  decision: "allow" | "deny";
  tier: AiTier;
  reason: string;
};

export type PolicyCheckInput = {
  actorUserId: number;
  feature: string;
  action: AiAction;
  entityType?: EntityType | null;
  resource?: FloorResource | null;
  entityId?: number | null;
  projectId?: number | null;
  fields?: Record<string, unknown> | null;
};

export type PolicyLayerFns = {
  instance: (input: PolicyCheckInput) => PolicyDecision;
  project: (input: PolicyCheckInput) => PolicyDecision;
  user: (input: PolicyCheckInput) => PolicyDecision;
};

const READ_TYPES = new Set<EntityType>(["idea", "project", "task", "document"]);
const WRITE_TYPES = new Set<EntityType>(["idea", "document", "task"]);

export function tierForAction(action: AiAction): AiTier {
  switch (action) {
    case "read":
    case "web_fetch":
      return 0;
    case "link":
    case "tag":
    case "comment":
      return 1;
    case "propose_create":
    case "propose_update":
    case "apply":
      return 2;
    case "propose_delete":
    case "bulk":
      return 3;
  }
}

export function isFloorResource(value: string): value is FloorResource {
  return (FLOOR_RESOURCES as readonly string[]).includes(value);
}

function floorDecision(input: PolicyCheckInput): PolicyDecision | null {
  if (input.resource && isFloorResource(input.resource)) {
    return {
      decision: "deny",
      tier: 3,
      reason: `AI cannot access ${input.resource}`,
    };
  }
  if (input.fields && Object.prototype.hasOwnProperty.call(input.fields, "ownerId")) {
    return {
      decision: "deny",
      tier: 3,
      reason: "AI cannot transfer ownership",
    };
  }
  return null;
}

function instanceAllows(input: PolicyCheckInput): boolean {
  if (input.resource) return false;
  if (input.action === "web_fetch") {
    return input.entityType == null;
  }
  if (input.action === "read") {
    if (input.entityType == null) return true;
    return READ_TYPES.has(input.entityType);
  }
  if (
    input.action === "propose_create" ||
    input.action === "propose_update" ||
    input.action === "apply"
  ) {
    return input.entityType != null && WRITE_TYPES.has(input.entityType);
  }
  return false;
}

export function instancePolicyLayer(input: PolicyCheckInput): PolicyDecision {
  const tier = tierForAction(input.action);
  if (instanceAllows(input)) {
    return { decision: "allow", tier, reason: "Allowed by instance policy" };
  }
  return { decision: "deny", tier, reason: "Denied by instance policy" };
}

/** T0184 replaces this. Project settings can only narrow the instance ceiling. */
export function projectPolicyLayer(input: PolicyCheckInput): PolicyDecision {
  return {
    decision: "allow",
    tier: tierForAction(input.action),
    reason: "Project layer allows all until T0184",
  };
}

/** T0190 replaces this. A user can only narrow the ceiling. */
export function userPolicyLayer(input: PolicyCheckInput): PolicyDecision {
  return {
    decision: "allow",
    tier: tierForAction(input.action),
    reason: "User layer allows all until T0190",
  };
}

const DEFAULT_LAYERS: PolicyLayerFns = {
  instance: instancePolicyLayer,
  project: projectPolicyLayer,
  user: userPolicyLayer,
};

/**
 * Floor first, then instance ∩ project ∩ user. Any deny wins.
 * Layer overrides exist so tests can prove the floor still denies.
 */
export function check(
  input: PolicyCheckInput,
  layers?: Partial<PolicyLayerFns>,
): PolicyDecision {
  const floor = floorDecision(input);
  if (floor) return floor;

  const resolved: PolicyLayerFns = { ...DEFAULT_LAYERS, ...layers };
  const parts = [
    resolved.instance(input),
    resolved.project(input),
    resolved.user(input),
  ];
  const denied = parts.find((part) => part.decision === "deny");
  if (denied) {
    return { decision: "deny", tier: tierForAction(input.action), reason: denied.reason };
  }
  return {
    decision: "allow",
    tier: tierForAction(input.action),
    reason: "Allowed",
  };
}

/** Informational summary for the system prompt. Enforcement stays in `check`. */
export function describeAllowedPolicy(feature: string): string {
  return (
    `Allowed for the ${feature} feature (informational only; the server enforces these rules): ` +
    "read ideas, projects, tasks, and documents; propose and apply creates and updates of ideas, documents, and tasks; fetch public web pages. " +
    "Not allowed: link, tag, comment, propose delete, bulk, and any other record type. " +
    "Never allowed: users, roles, groups, API keys, AI credentials, backups, ownership transfer, system properties, and AI policy."
  );
}
