import { z } from "zod";
import { formatEntityRef } from "../../../lib/entityRef.js";
import { TASK_PRIORITIES, type TaskPriority } from "../../../lib/taskFields.js";
import { check, type PolicyCheckInput } from "../aiPolicy.js";
import { defaultAiPermissionSettings, type AiPermissionSettings } from "../aiTiers.js";
import { CaptureError } from "./service.js";
import { captureOperations } from "./resolve.js";
import {
  CAPTURE_LOOKUP_TYPES,
  CAPTURE_RECORD_TYPES,
  type CaptureProposal,
  type CaptureRecordType,
  type CaptureRef,
} from "./types.js";

const linkBody = z
  .object({
    entityType: z.enum(CAPTURE_LOOKUP_TYPES),
    id: z.number().int().positive(),
  })
  .strict();

export const confirmBodySchema = z
  .object({
    recordType: z.enum(CAPTURE_RECORD_TYPES),
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(8_000).nullable().optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    priority: z.enum(TASK_PRIORITIES).nullable().optional(),
    projectId: z.number().int().positive().nullable().optional(),
    listId: z.number().int().positive().nullable().optional(),
    parentId: z.number().int().positive().nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(8).optional(),
    links: z.array(linkBody).max(5).optional(),
  })
  .strict();

export type ConfirmBody = z.infer<typeof confirmBodySchema>;

export type CaptureConfirmResult = {
  entityType: CaptureRecordType;
  id: number;
  ref: string;
  title: string;
  warnings: string[];
};

export type CaptureWriters = {
  create: (proposal: CaptureProposal) => Promise<{ id: number; number: number }>;
  addToList?: (listId: number, entityId: number) => Promise<void>;
  addTag?: (entityType: CaptureRecordType, entityId: number, name: string) => Promise<string | null>;
  addLink?: (entityType: CaptureRecordType, entityId: number, link: CaptureRef) => Promise<string | null>;
};

export type CaptureConfirmAudit = (row: {
  userId: number;
  feature: "capture";
  action: "apply";
  entityType: string | null;
  entityId: number | null;
  projectId: number | null;
  decision: "allow" | "deny";
  reason: string | null;
  tier: number;
  latencyMs: number;
}) => Promise<void>;

type ActorPermission = {
  settings: AiPermissionSettings;
  off: readonly string[];
  policy: { featuresOff: readonly string[] };
};

type Access = "full" | "read_only" | "excluded" | null;

function refOf(entityType: CaptureRef["entityType"], id: number, projectId: number | null): CaptureRef {
  return { entityType, id, ref: "", title: "", projectId };
}

/** Drops fields that do not apply to the chosen record type. */
export function proposalFromConfirm(body: ConfirmBody): CaptureProposal {
  const recordType = body.recordType;
  const idea = recordType === "idea";
  const description = body.description?.trim() ? body.description.trim() : null;
  return {
    recordType,
    title: body.title.trim(),
    description,
    dueDate: idea ? null : (body.dueDate ?? null),
    priority: idea ? null : (body.priority ?? null),
    project: idea || body.projectId == null ? null : refOf("project", body.projectId, null),
    list: recordType === "todo" && body.listId != null ? refOf("todo_list", body.listId, body.projectId ?? null) : null,
    tags: body.tags ?? [],
    parent: recordType === "task" && body.parentId != null ? refOf("task", body.parentId, body.projectId ?? null) : null,
    links: (body.links ?? []).map((link) => refOf(link.entityType, link.id, null)),
  };
}

async function denial(
  proposal: CaptureProposal,
  actorUserId: number,
  permission: ActorPermission,
  accessFor: (projectId: number) => Promise<Access>,
): Promise<{ reason: string; tier: number } | null> {
  const operations = captureOperations(proposal, actorUserId);
  if (operations.length === 0) {
    return { reason: "A title and record type are required.", tier: 2 };
  }
  for (const operation of operations) {
    const projectId = operation.projectId ?? null;
    const decision = check(
      {
        action: operation.action as PolicyCheckInput["action"],
        entityType: (operation.entityType ?? null) as PolicyCheckInput["entityType"],
        entityId: operation.entityId ?? null,
        projectId,
        actorUserId,
        fields: operation.fields ?? null,
        feature: "capture",
        userOff: permission.off,
        projectAiAccess: projectId == null ? null : await accessFor(projectId),
      },
      undefined,
      permission.settings,
    );
    if (decision.decision === "deny") {
      return { reason: decision.reason, tier: decision.tier };
    }
  }
  return null;
}

async function sideEffect(run: () => Promise<string | null>, warnings: string[]): Promise<void> {
  try {
    const message = await run();
    if (message) warnings.push(message);
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : "Could not finish a follow-up.");
  }
}

export async function executeCaptureConfirm(args: {
  actorUserId: number;
  body: unknown;
  permission?: ActorPermission;
  accessFor?: (projectId: number) => Promise<Access>;
  writers: CaptureWriters;
  audit?: CaptureConfirmAudit;
}): Promise<CaptureConfirmResult> {
  const started = Date.now();
  const parsed = confirmBodySchema.parse(args.body);
  const proposal = proposalFromConfirm(parsed);
  const permission = args.permission ?? {
    settings: defaultAiPermissionSettings(),
    off: [],
    policy: { featuresOff: [] },
  };
  const accessFor = args.accessFor ?? (async () => "full" as const);
  const projectId = proposal.project?.id ?? null;

  const audit = async (
    decision: "allow" | "deny",
    reason: string | null,
    tier: number,
    entityId: number | null,
  ) => {
    await args.audit?.({
      userId: args.actorUserId,
      feature: "capture",
      action: "apply",
      entityType: proposal.recordType,
      entityId,
      projectId,
      decision,
      reason,
      tier,
      latencyMs: Date.now() - started,
    });
  };

  if (permission.policy.featuresOff.includes("capture")) {
    await audit("deny", "Capture is turned off.", 3, null);
    throw new CaptureError(403, "feature_off", "Capture is turned off.");
  }

  const denied = await denial(proposal, args.actorUserId, permission, accessFor);
  if (denied) {
    await audit("deny", denied.reason, denied.tier, null);
    throw new CaptureError(403, "ai_policy_denied", denied.reason);
  }

  let created: { id: number; number: number };
  try {
    created = await args.writers.create(proposal);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create the record.";
    const tier = err instanceof CaptureError ? err.status === 403 ? 3 : 2 : 2;
    await audit("deny", message, tier, null);
    throw err;
  }

  const warnings: string[] = [];
  if (proposal.recordType === "todo" && proposal.list && args.writers.addToList) {
    const listId = proposal.list.id;
    await sideEffect(() => args.writers.addToList!(listId, created.id).then(() => null), warnings);
  }
  if (args.writers.addTag) {
    for (const tag of proposal.tags) {
      await sideEffect(() => args.writers.addTag!(proposal.recordType!, created.id, tag), warnings);
    }
  }
  if (args.writers.addLink) {
    for (const link of proposal.links) {
      await sideEffect(() => args.writers.addLink!(proposal.recordType!, created.id, link), warnings);
    }
  }

  await audit("allow", null, 2, created.id);
  return {
    entityType: proposal.recordType!,
    id: created.id,
    ref: formatEntityRef(proposal.recordType!, created.number),
    title: proposal.title,
    warnings,
  };
}
