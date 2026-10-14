import type { EntityType } from "../../lib/entityType.js";
import {
  classifyOperation,
  defaultActionTier,
  defaultAiPermissionSettings,
  type AiPermissionSettings,
  type AiTier,
} from "./aiTiers.js";
import type { AiAccess } from "./aiAccess.js";

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

export type { AiTier } from "./aiTiers.js";

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
  /** Effective access of `projectId`. Omitted with a project id fails closed. */
  projectAiAccess?: AiAccess | null;
  /** Effective access of `fields.projectId` when that id is a different project. */
  destinationAiAccess?: AiAccess | null;
  fields?: Record<string, unknown> | null;
  /** Owner of the target record, when the server already knows it. */
  targetOwnerId?: number | null;
  /** Chat web fetch is allowed only when the Administrator has turned it on. */
  webFetchEnabled?: boolean;
  /** This turn already included private record, page, or file text. */
  privateRecordsInTurn?: boolean;
  /** Ignored. The model cannot choose a tier. */
  tier?: unknown;
  /** Action keys this user turned off (`action` or `action:entityType`). */
  userOff?: readonly string[];
};

export type PolicyLayerFns = {
  instance: (input: PolicyCheckInput) => PolicyDecision;
  project: (input: PolicyCheckInput) => PolicyDecision;
  user: (input: PolicyCheckInput) => PolicyDecision;
};

export const AI_READ_ENTITY_TYPES = [
  "idea",
  "project",
  "task",
  "document",
  "todo",
  "todo_list",
] as const;

export const AI_WRITE_ENTITY_TYPES = ["idea", "document", "task", "todo", "todo_list"] as const;

const READ_TYPES = new Set<EntityType>(AI_READ_ENTITY_TYPES);
const WRITE_TYPES = new Set<EntityType>(AI_WRITE_ENTITY_TYPES);

/** Administrator default for the action, before opt-in and escalation. */
export function tierForAction(action: AiAction): AiTier {
  return defaultActionTier(action);
}

export function isFloorResource(value: string): value is FloorResource {
  return (FLOOR_RESOURCES as readonly string[]).includes(value);
}

function privateFetchDecision(input: PolicyCheckInput): PolicyDecision | null {
  if (
    input.action === "web_fetch" &&
    input.feature !== "assistant" &&
    input.privateRecordsInTurn === true
  ) {
    return {
      decision: "deny",
      tier: tierForAction("web_fetch"),
      reason: "web_fetch denied after private records",
    };
  }
  return null;
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
  if (
    input.fields &&
    (Object.prototype.hasOwnProperty.call(input.fields, "aiAccess") ||
      Object.prototype.hasOwnProperty.call(input.fields, "ai_access") ||
      Object.prototype.hasOwnProperty.call(input.fields, "aiLocalOnly") ||
      Object.prototype.hasOwnProperty.call(input.fields, "ai_local_only"))
  ) {
    return {
      decision: "deny",
      tier: 3,
      reason: "AI cannot change project AI access",
    };
  }
  return null;
}

function instanceAllows(input: PolicyCheckInput): boolean {
  if (input.resource) return false;
  if (input.action === "web_fetch") {
    return (
      input.feature === "assistant" &&
      input.webFetchEnabled === true &&
      input.entityType == null
    );
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
  if (input.action === "link" || input.action === "tag" || input.action === "comment") {
    return input.entityType != null && READ_TYPES.has(input.entityType);
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

function destinationProjectId(input: PolicyCheckInput): number | null {
  const raw = input.fields?.projectId;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : null;
}

function projectAccessDecision(
  access: AiAccess | null | undefined,
  required: boolean,
  action: AiAction,
): PolicyDecision | null {
  if (!required) return null;
  const tier = tierForAction(action);
  if (access == null) {
    return { decision: "deny", tier, reason: "Project AI access was not resolved" };
  }
  if (access === "excluded") {
    return { decision: "deny", tier, reason: "Project is excluded from AI" };
  }
  if (access === "read_only" && action !== "read") {
    return { decision: "deny", tier, reason: "Project is read-only for AI" };
  }
  return null;
}

/** Project settings can only narrow the instance ceiling. The caller passes effective access. */
export function projectPolicyLayer(input: PolicyCheckInput): PolicyDecision {
  const tier = tierForAction(input.action);
  const source = projectAccessDecision(input.projectAiAccess, input.projectId != null, input.action);
  if (source) return source;
  const destId = destinationProjectId(input);
  const dest = projectAccessDecision(
    input.destinationAiAccess,
    destId != null && destId !== input.projectId,
    input.action,
  );
  if (dest) return dest;
  return { decision: "allow", tier, reason: "Allowed by project AI access" };
}

function userTurnedOff(input: PolicyCheckInput): boolean {
  const off = input.userOff;
  if (!off || off.length === 0) return false;
  if (off.includes(input.action)) return true;
  return input.entityType != null && off.includes(`${input.action}:${input.entityType}`);
}

/** A user can only narrow the ceiling. Off keys deny; they cannot enable a denied action. */
export function userPolicyLayer(input: PolicyCheckInput): PolicyDecision {
  const tier = tierForAction(input.action);
  if (userTurnedOff(input)) {
    return { decision: "deny", tier, reason: "Turned off by the user" };
  }
  return { decision: "allow", tier, reason: "Allowed by the user" };
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
  settings: AiPermissionSettings = defaultAiPermissionSettings(),
): PolicyDecision {
  const floor = floorDecision(input);
  if (floor) return floor;
  const privateFetch = privateFetchDecision(input);
  if (privateFetch) return privateFetch;

  const classified = classifyOperation(
    {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      targetOwnerId: input.targetOwnerId,
      fields: input.fields,
      tier: input.tier,
    },
    settings,
  );

  const resolved: PolicyLayerFns = { ...DEFAULT_LAYERS, ...layers };
  const parts = [
    resolved.instance(input),
    resolved.project(input),
    resolved.user(input),
  ];
  const denied = parts.find((part) => part.decision === "deny");
  if (denied) {
    return { decision: "deny", tier: classified.tier, reason: denied.reason };
  }
  return {
    decision: "allow",
    tier: classified.tier,
    reason: "Allowed",
  };
}

/** Informational summary for the system prompt. Enforcement stays in `check`. */
export function describeAllowedPolicy(
  feature: string,
  options?: { webFetchEnabled?: boolean },
): string {
  const actions = options?.webFetchEnabled
    ? "read ideas, projects, tasks, documents, todos, and todo lists; propose and apply creates and updates of ideas, documents, tasks, todos, and todo lists; add links, tags, comments, and task dependencies; fetch public web pages. "
    : "read ideas, projects, tasks, documents, todos, and todo lists; propose and apply creates and updates of ideas, documents, tasks, todos, and todo lists; add links, tags, comments, and task dependencies. ";
  return (
    `Allowed for the ${feature} feature (informational only; the server enforces these rules): ` +
    actions +
    "Not allowed: propose delete, bulk, boards, canvases, wiki nodes, image boards, and removing a link, tag, or dependency. " +
    "Projects may be read-only for AI or excluded entirely. Excluded projects and their records are omitted. Read-only projects can be read but not changed. " +
    "A project marked local-only is served only by a local model. " +
    "Never allowed: users, roles, groups, API keys, AI credentials, backups, ownership transfer, system properties, AI policy, and project AI access. " +
    "The server assigns the permission tier; the model cannot set it. Deletes are proposals only, and a person deletes the record in the app."
  );
}
