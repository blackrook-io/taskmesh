import { and, asc, desc, eq, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { ilikeEscaped } from "../../lib/ilike.js";
import type { AiAuditSink } from "./aiAudit.js";
import { writeAiAudit } from "./aiAudit.js";
import {
  check,
  isFloorResource,
  tierForAction,
  type AiAction,
  type PolicyCheckInput,
  type PolicyDecision,
  type PolicyLayerFns,
} from "./aiPolicy.js";
import { fetchUrlForAssistant } from "./fetchUrl.js";
import { isEntityType, type EntityType } from "../../lib/entityType.js";
import {
  assertCanAccessDualScoped,
  assertCanAccessOwned,
  assertCanAccessProject,
  dualScopeListFilter,
  ownerScope,
  projectAccessListFilter,
  projectOwnedListFilter,
  OwnershipAccessError,
} from "../ownership.js";
import { actorCanReopen, enforceTaskPatch, TaskWorkflowError } from "../taskWorkflow.js";

export type AssistantProposal = {
  id: string;
  action: "create" | "update";
  entityType: "idea" | "document" | "task";
  /** Present for updates */
  entityId?: number;
  projectId?: number;
  summary: string;
  fields: Record<string, unknown>;
  method: "POST" | "PATCH";
  path: string;
};

export type ToolHandlers = {
  onTool?: (info: { name: string; args: unknown }) => void;
  onProposal?: (proposal: AssistantProposal) => void;
  signal?: AbortSignal;
  /** Authenticated actor for ownership scoping (required for DB tools). */
  actorUserId?: number;
  isAdministrator?: boolean;
  feature?: string;
  provider?: string | null;
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  /** Test seam. Production uses `check` and `writeAiAudit`. */
  checkPolicy?: (input: PolicyCheckInput, layers?: Partial<PolicyLayerFns>) => PolicyDecision;
  recordAudit?: AiAuditSink;
};

type ToolPolicyTarget = {
  action: AiAction;
  entityType?: EntityType | null;
  resource?: PolicyCheckInput["resource"];
  entityId?: number | null;
  projectId?: number | null;
};

/** OpenAI Chat Completions tool definitions */
export const OPENAI_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_records",
      description: "Search ideas, projects, tasks, and documents by text query.",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Search text" },
        },
        required: ["q"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_entity",
      description: "Load one idea, project, document, or task by id.",
      parameters: {
        type: "object",
        properties: {
          entityType: { type: "string", enum: ["idea", "project", "document", "task"] },
          entityId: { type: "integer" },
        },
        required: ["entityType", "entityId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_project_context",
      description: "List document and task titles for a project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "integer" },
        },
        required: ["projectId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "fetch_url",
      description:
        "Fetch a public http(s) URL and return plain text for research. Cite the URL when using the content. Do not use for private/local addresses.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full http or https URL" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_idea_update",
      description:
        "Propose updating an idea. Does not save; the user must confirm in the UI.",
      parameters: {
        type: "object",
        properties: {
          ideaId: { type: "integer" },
          title: { type: "string" },
          body: { type: "string", description: "Markdown body" },
          summary: { type: "string", description: "Short human summary of the change" },
        },
        required: ["ideaId", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_document_update",
      description:
        "Propose updating a project document. Does not save; the user must confirm in the UI.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "integer" },
          documentId: { type: "integer" },
          title: { type: "string" },
          body: { type: "string", description: "Markdown body" },
          summary: { type: "string" },
        },
        required: ["projectId", "documentId", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_task_update",
      description:
        "Propose updating an existing task. Does not save; the user must confirm in the UI. State changes must follow the task workflow. Cancel and reopen require stateComment. Pending and Deleted cannot be set. Complete, Canceled, and Deleted tasks reject field edits.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "integer" },
          taskId: { type: "integer" },
          title: { type: "string" },
          description: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD or null to clear" },
          color: { type: "string" },
          state: {
            type: "string",
            description:
              "Next state only: Draft to Ready or Canceled; Ready to In Progress or Canceled; In Progress to On Hold or Complete; On Hold to In Progress or Complete; Complete or Canceled to Ready for a project Owner, Manager, or Administrator.",
          },
          stateComment: {
            type: "string",
            description: "Required when canceling or reopening.",
          },
          priority: { type: "string" },
          summary: { type: "string" },
        },
        required: ["projectId", "taskId", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_idea_create",
      description:
        "Propose creating a new idea. Does not save; the user must confirm in the UI.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string", description: "Markdown body" },
          summary: { type: "string" },
        },
        required: ["title", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_document_create",
      description:
        "Propose creating a new project document. Does not save; the user must confirm in the UI.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "integer" },
          title: { type: "string" },
          body: { type: "string", description: "Markdown body" },
          summary: { type: "string" },
        },
        required: ["projectId", "title", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_task_create",
      description:
        "Propose creating a new task in a project (title required). Does not save; the user must confirm in the UI. Prefer this when the user asks to add/create tasks.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "integer" },
          title: { type: "string" },
          description: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
          color: { type: "string" },
          summary: { type: "string" },
        },
        required: ["projectId", "title", "summary"],
      },
    },
  },
];

function clip(s: string, max = 4000): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}


function requireActor(handlers: ToolHandlers): { actorUserId: number; isAdministrator: boolean } {
  if (handlers.actorUserId == null) {
    throw new Error("Assistant tool missing actor context");
  }
  return {
    actorUserId: handlers.actorUserId,
    isAdministrator: Boolean(handlers.isAdministrator),
  };
}

function accessDeniedMessage(): string {
  return JSON.stringify({ error: "Access denied" });
}

function proposalId(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function numField(args: unknown, key: string): number | null {
  if (!args || typeof args !== "object") return null;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function policyTargetForTool(name: string, args: unknown): ToolPolicyTarget | null {
  const entityTypeRaw =
    args && typeof args === "object" ? (args as Record<string, unknown>).entityType : undefined;
  const entityType = typeof entityTypeRaw === "string" && isEntityType(entityTypeRaw) ? entityTypeRaw : null;
  const resource =
    typeof entityTypeRaw === "string" && isFloorResource(entityTypeRaw) ? entityTypeRaw : null;

  switch (name) {
    case "search_records":
      return { action: "read" };
    case "get_entity":
      return { action: "read", entityType, resource };
    case "list_project_context":
      return { action: "read", entityType: "project", projectId: numField(args, "projectId") };
    case "fetch_url":
      return { action: "web_fetch" };
    case "propose_idea_update":
      return { action: "propose_update", entityType: "idea", entityId: numField(args, "ideaId") };
    case "propose_document_update":
      return {
        action: "propose_update",
        entityType: "document",
        entityId: numField(args, "documentId"),
        projectId: numField(args, "projectId"),
      };
    case "propose_task_update":
      return {
        action: "propose_update",
        entityType: "task",
        entityId: numField(args, "taskId"),
        projectId: numField(args, "projectId"),
      };
    case "propose_idea_create":
      return { action: "propose_create", entityType: "idea" };
    case "propose_document_create":
      return {
        action: "propose_create",
        entityType: "document",
        projectId: numField(args, "projectId"),
      };
    case "propose_task_create":
      return {
        action: "propose_create",
        entityType: "task",
        projectId: numField(args, "projectId"),
      };
    default:
      return null;
  }
}

function denialPayload(action: AiAction, decision: PolicyDecision): string {
  return JSON.stringify({
    denied: true,
    decision: "deny",
    action,
    reason: decision.reason,
    tier: decision.tier,
  });
}

function ownerFields(args: unknown): Record<string, unknown> | null {
  if (!args || typeof args !== "object" || !Object.prototype.hasOwnProperty.call(args, "ownerId")) {
    return null;
  }
  return { ownerId: (args as Record<string, unknown>).ownerId };
}

async function auditTool(
  handlers: ToolHandlers,
  name: string,
  target: ToolPolicyTarget,
  decision: PolicyDecision,
  startedAt: number,
): Promise<void> {
  await writeAiAudit(
    {
      userId: handlers.actorUserId ?? null,
      feature: handlers.feature ?? "assistant",
      provider: handlers.provider ?? null,
      model: handlers.model ?? null,
      tool: name,
      action: target.action,
      entityType: target.entityType ?? target.resource ?? null,
      entityId: target.entityId ?? null,
      projectId: target.projectId ?? null,
      decision: decision.decision,
      reason: decision.reason,
      tier: decision.tier,
      tokensIn: handlers.tokensIn ?? null,
      tokensOut: handlers.tokensOut ?? null,
      latencyMs: Date.now() - startedAt,
    },
    handlers.recordAudit,
  );
}

async function dispatchTool(name: string, args: unknown, handlers: ToolHandlers): Promise<string> {
  switch (name) {
    case "search_records":
      return await toolSearch(args, handlers);
    case "get_entity":
      return await toolGetEntity(args, handlers);
    case "list_project_context":
      return await toolListProject(args, handlers);
    case "fetch_url":
      return await toolFetchUrl(args, handlers.signal);
    case "propose_idea_update":
      return await toolProposeIdeaUpdate(args, handlers);
    case "propose_document_update":
      return await toolProposeDocumentUpdate(args, handlers);
    case "propose_task_update":
      return await toolProposeTaskUpdate(args, handlers);
    case "propose_idea_create":
      return await toolProposeIdeaCreate(args, handlers);
    case "propose_document_create":
      return await toolProposeDocumentCreate(args, handlers);
    case "propose_task_create":
      return await toolProposeTaskCreate(args, handlers);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

export async function executeAssistantTool(
  name: string,
  argsJson: string,
  handlers: ToolHandlers = {},
): Promise<string> {
  let args: unknown = {};
  let invalidJson = false;
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    invalidJson = true;
  }

  const target = policyTargetForTool(name, invalidJson ? {} : args);
  if (!target) {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  handlers.onTool?.({ name, args });
  const started = Date.now();

  if (invalidJson) {
    const decision: PolicyDecision = {
      decision: "deny",
      tier: tierForAction(target.action),
      reason: "Invalid JSON arguments",
    };
    await auditTool(handlers, name, target, decision, started);
    return denialPayload(target.action, decision);
  }

  const decide = handlers.checkPolicy ?? check;
  const decision = decide({
    actorUserId: handlers.actorUserId ?? 0,
    feature: handlers.feature ?? "assistant",
    action: target.action,
    entityType: target.entityType,
    resource: target.resource,
    entityId: target.entityId,
    projectId: target.projectId,
    fields: ownerFields(args),
  });

  if (decision.decision === "deny") {
    await auditTool(handlers, name, target, decision, started);
    return denialPayload(target.action, decision);
  }

  try {
    const result = await dispatchTool(name, args, handlers);
    await auditTool(handlers, name, target, decision, started);
    return result;
  } catch (err) {
    await auditTool(handlers, name, target, decision, started);
    return JSON.stringify({
      error: err instanceof Error ? err.message : "Tool failed",
    });
  }
}

async function toolFetchUrl(args: unknown, signal?: AbortSignal): Promise<string> {
  const { url } = z.object({ url: z.string().url().max(2000) }).parse(args);
  const result = await fetchUrlForAssistant(url, signal);
  return JSON.stringify({
    url: result.url,
    title: result.title,
    truncated: result.truncated,
    text: result.text,
    note: "Cite this URL when quoting or summarizing. Content is plain text only.",
  });
}

async function toolSearch(args: unknown, handlers: ToolHandlers): Promise<string> {
  const { q } = z.object({ q: z.string().min(1).max(200) }).parse(args);
  const { actorUserId, isAdministrator } = requireActor(handlers);
  const ideaScope = ownerScope(schema.ideas.ownerId, actorUserId, isAdministrator);
  const projectScope = projectAccessListFilter(db, actorUserId, isAdministrator);
  const taskScope = dualScopeListFilter(
    db,
    schema.tasks.projectId,
    schema.tasks.ownerId,
    actorUserId,
    isAdministrator,
  );
  const documentScope = projectOwnedListFilter(
    db,
    schema.projectDocuments.projectId,
    actorUserId,
    isAdministrator,
  );
  const [ideas, projects, tasks, documents] = await Promise.all([
    db
      .select({ id: schema.ideas.id, title: schema.ideas.title })
      .from(schema.ideas)
      .where(
        and(
          or(ilikeEscaped(schema.ideas.title, q), ilikeEscaped(schema.ideas.body, q)),
          ideaScope ?? sql`true`,
        ),
      )
      .orderBy(desc(schema.ideas.updatedAt))
      .limit(8),
    db
      .select({ id: schema.projects.id, name: schema.projects.name })
      .from(schema.projects)
      .where(
        and(
          or(ilikeEscaped(schema.projects.name, q), ilikeEscaped(schema.projects.description, q)),
          projectScope ?? sql`true`,
        ),
      )
      .orderBy(desc(schema.projects.updatedAt))
      .limit(8),
    db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        projectId: schema.tasks.projectId,
      })
      .from(schema.tasks)
      .where(
        and(
          ne(schema.tasks.state, "deleted"),
          or(ilikeEscaped(schema.tasks.title, q), ilikeEscaped(schema.tasks.description, q)),
          taskScope ?? sql`true`,
        ),
      )
      .orderBy(desc(schema.tasks.updatedAt))
      .limit(8),
    db
      .select({
        id: schema.projectDocuments.id,
        title: schema.projectDocuments.title,
        projectId: schema.projectDocuments.projectId,
      })
      .from(schema.projectDocuments)
      .where(
        and(
          or(
            ilikeEscaped(schema.projectDocuments.title, q),
            ilikeEscaped(schema.projectDocuments.body, q),
          ),
          documentScope ?? sql`true`,
        ),
      )
      .orderBy(desc(schema.projectDocuments.updatedAt))
      .limit(8),
  ]);
  return JSON.stringify({ ideas, projects, tasks, documents });
}

async function toolGetEntity(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      entityType: z.enum(["idea", "project", "document", "task"]),
      entityId: z.number().int().positive(),
    })
    .parse(args);
  const { actorUserId } = requireActor(handlers);

  try {
    if (parsed.entityType === "idea") {
      const [row] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, parsed.entityId));
      if (!row) return JSON.stringify({ error: "Idea not found" });
      await assertCanAccessOwned(db, actorUserId, row.ownerId);
      return JSON.stringify({
        type: "idea",
        id: row.id,
        title: row.title,
        body: clip(row.body ?? "", 8000),
      });
    }
    if (parsed.entityType === "project") {
      const row = await assertCanAccessProject(db, actorUserId, parsed.entityId);
      return JSON.stringify({
        type: "project",
        id: row.id,
        name: row.name,
        description: clip(row.description ?? "", 4000),
        status: row.status,
      });
    }
    if (parsed.entityType === "document") {
      const [row] = await db
        .select()
        .from(schema.projectDocuments)
        .where(eq(schema.projectDocuments.id, parsed.entityId));
      if (!row) return JSON.stringify({ error: "Document not found" });
      await assertCanAccessProject(db, actorUserId, row.projectId);
      return JSON.stringify({
        type: "document",
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        body: clip(row.body ?? "", 8000),
      });
    }
    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, parsed.entityId));
    if (!row) return JSON.stringify({ error: "Task not found" });
    await assertCanAccessDualScoped(db, actorUserId, row);
    return JSON.stringify({
      type: "task",
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      description: clip(row.description ?? "", 4000),
      dueDate: row.dueDate ?? null,
      number: row.number,
      state: row.state,
      priority: row.priority,
      parentId: row.parentId,
      color: row.color,
      phaseId: row.phaseId,
    });
  } catch (err) {
    if (err instanceof OwnershipAccessError) return accessDeniedMessage();
    throw err;
  }
}

async function toolListProject(args: unknown, handlers: ToolHandlers): Promise<string> {
  const { projectId } = z.object({ projectId: z.number().int().positive() }).parse(args);
  const { actorUserId } = requireActor(handlers);
  try {
    const proj = await assertCanAccessProject(db, actorUserId, projectId);
    const [docs, tasks] = await Promise.all([
      db
        .select({ id: schema.projectDocuments.id, title: schema.projectDocuments.title })
        .from(schema.projectDocuments)
        .where(eq(schema.projectDocuments.projectId, projectId))
        .orderBy(schema.projectDocuments.position)
        .limit(40),
      db
        .select({ id: schema.tasks.id, title: schema.tasks.title })
        .from(schema.tasks)
        .where(eq(schema.tasks.projectId, projectId))
        .orderBy(schema.tasks.sortOrder)
        .limit(40),
    ]);
    return JSON.stringify({
      project: { id: proj.id, name: proj.name, status: proj.status },
      documents: docs,
      tasks,
    });
  } catch (err) {
    if (err instanceof OwnershipAccessError) return accessDeniedMessage();
    throw err;
  }
}

async function toolProposeIdeaUpdate(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      ideaId: z.number().int().positive(),
      title: z.string().min(1).max(500).optional(),
      body: z.string().max(500_000).optional(),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const [existing] = await db
    .select()
    .from(schema.ideas)
    .where(eq(schema.ideas.id, parsed.ideaId));
  if (!existing) return JSON.stringify({ error: "Idea not found" });
  try {
    await assertCanAccessOwned(db, requireActor(handlers).actorUserId, existing.ownerId);
  } catch (err) {
    if (err instanceof OwnershipAccessError) return accessDeniedMessage();
    throw err;
  }
  const fields: Record<string, unknown> = {};
  if (parsed.title !== undefined) fields.title = parsed.title;
  if (parsed.body !== undefined) fields.body = parsed.body;
  if (Object.keys(fields).length === 0) {
    return JSON.stringify({ error: "Provide title and/or body to update" });
  }
  const proposal: AssistantProposal = {
    id: proposalId(),
    action: "update",
    entityType: "idea",
    entityId: parsed.ideaId,
    summary: parsed.summary,
    fields,
    method: "PATCH",
    path: `/api/v1/ideas/${parsed.ideaId}`,
  };
  handlers.onProposal?.(proposal);
  return JSON.stringify({
    ok: true,
    proposalId: proposal.id,
    message: "Proposal sent to the user for confirmation. Do not claim it was saved.",
  });
}

async function toolProposeDocumentUpdate(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      projectId: z.number().int().positive(),
      documentId: z.number().int().positive(),
      title: z.string().min(1).max(500).optional(),
      body: z.string().max(500_000).optional(),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const [existing] = await db
    .select()
    .from(schema.projectDocuments)
    .where(
      and(
        eq(schema.projectDocuments.id, parsed.documentId),
        eq(schema.projectDocuments.projectId, parsed.projectId),
      ),
    );
  if (!existing) return JSON.stringify({ error: "Document not found" });
  try {
    await assertCanAccessProject(db, requireActor(handlers).actorUserId, parsed.projectId, "write");
  } catch (err) {
    if (err instanceof OwnershipAccessError) return accessDeniedMessage();
    throw err;
  }
  const fields: Record<string, unknown> = {};
  if (parsed.title !== undefined) fields.title = parsed.title;
  if (parsed.body !== undefined) fields.body = parsed.body;
  if (Object.keys(fields).length === 0) {
    return JSON.stringify({ error: "Provide title and/or body to update" });
  }
  const proposal: AssistantProposal = {
    id: proposalId(),
    action: "update",
    entityType: "document",
    entityId: parsed.documentId,
    projectId: parsed.projectId,
    summary: parsed.summary,
    fields,
    method: "PATCH",
    path: `/api/v1/projects/${parsed.projectId}/documents/${parsed.documentId}`,
  };
  handlers.onProposal?.(proposal);
  return JSON.stringify({
    ok: true,
    proposalId: proposal.id,
    message: "Proposal sent to the user for confirmation. Do not claim it was saved.",
  });
}

async function toolProposeTaskUpdate(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      projectId: z.number().int().positive(),
      taskId: z.number().int().positive(),
      title: z.string().min(1).max(2000).optional(),
      description: z.string().max(50_000).optional().nullable(),
      dueDate: z.string().nullable().optional(),
      color: z.string().max(64).optional().nullable(),
      state: z.string().optional(),
      stateComment: z.string().max(50_000).optional(),
      priority: z.string().optional(),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const [existing] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, parsed.taskId), eq(schema.tasks.projectId, parsed.projectId)));
  if (!existing) return JSON.stringify({ error: "Task not found" });
  try {
    await assertCanAccessDualScoped(db, requireActor(handlers).actorUserId, existing, "write");
  } catch (err) {
    if (err instanceof OwnershipAccessError) return accessDeniedMessage();
    throw err;
  }
  const fields: Record<string, unknown> = {};
  if (parsed.title !== undefined) fields.title = parsed.title;
  if (parsed.description !== undefined) fields.description = parsed.description;
  if (parsed.dueDate !== undefined) fields.dueDate = parsed.dueDate;
  if (parsed.color !== undefined) fields.color = parsed.color;
  if (parsed.state !== undefined) fields.state = parsed.state;
  if (parsed.stateComment !== undefined) fields.stateComment = parsed.stateComment;
  if (parsed.priority !== undefined) fields.priority = parsed.priority;
  if (Object.keys(fields).every((key) => key === "stateComment")) {
    return JSON.stringify({ error: "Provide at least one field to update" });
  }
  try {
    const canReopen = await actorCanReopen(db, requireActor(handlers).actorUserId, existing.projectId);
    enforceTaskPatch({
      fromState: existing.state,
      canReopen,
      patch: {
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(parsed.dueDate !== undefined ? { dueDate: parsed.dueDate } : {}),
        ...(parsed.color !== undefined ? { color: parsed.color } : {}),
        ...(parsed.state !== undefined ? { state: parsed.state } : {}),
        ...(parsed.stateComment !== undefined ? { stateComment: parsed.stateComment } : {}),
        ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
      },
    });
  } catch (err) {
    if (err instanceof TaskWorkflowError) return JSON.stringify({ error: err.message });
    throw err;
  }
  const proposal: AssistantProposal = {
    id: proposalId(),
    action: "update",
    entityType: "task",
    entityId: parsed.taskId,
    projectId: parsed.projectId,
    summary: parsed.summary,
    fields,
    method: "PATCH",
    path: `/api/v1/projects/${parsed.projectId}/tasks/${parsed.taskId}`,
  };
  handlers.onProposal?.(proposal);
  return JSON.stringify({
    ok: true,
    proposalId: proposal.id,
    message: "Proposal sent to the user for confirmation. Do not claim it was saved.",
  });
}

async function toolProposeIdeaCreate(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      title: z.string().min(1).max(500),
      body: z.string().max(500_000).optional().nullable(),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const fields: Record<string, unknown> = { title: parsed.title };
  if (parsed.body !== undefined) fields.body = parsed.body;
  const proposal: AssistantProposal = {
    id: proposalId(),
    action: "create",
    entityType: "idea",
    summary: parsed.summary,
    fields,
    method: "POST",
    path: `/api/v1/ideas`,
  };
  handlers.onProposal?.(proposal);
  return JSON.stringify({
    ok: true,
    proposalId: proposal.id,
    message: "Create proposal sent to the user for confirmation. Do not claim it was saved.",
  });
}

async function toolProposeDocumentCreate(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      projectId: z.coerce.number().int().positive(),
      title: z.string().min(1).max(500),
      body: z.string().max(500_000).optional().nullable(),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const [proj] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, parsed.projectId));
  if (!proj) return JSON.stringify({ error: "Project not found" });
  try {
    await assertCanAccessProject(db, requireActor(handlers).actorUserId, parsed.projectId, "write");
  } catch (err) {
    if (err instanceof OwnershipAccessError) return accessDeniedMessage();
    throw err;
  }
  const fields: Record<string, unknown> = { title: parsed.title };
  if (parsed.body !== undefined) fields.body = parsed.body;
  const proposal: AssistantProposal = {
    id: proposalId(),
    action: "create",
    entityType: "document",
    projectId: parsed.projectId,
    summary: parsed.summary,
    fields,
    method: "POST",
    path: `/api/v1/projects/${parsed.projectId}/documents`,
  };
  handlers.onProposal?.(proposal);
  return JSON.stringify({
    ok: true,
    proposalId: proposal.id,
    message: "Create proposal sent to the user for confirmation. Do not claim it was saved.",
  });
}

async function toolProposeTaskCreate(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      projectId: z.coerce.number().int().positive(),
      title: z.string().min(1).max(2000),
      description: z.string().max(50_000).optional().nullable(),
      dueDate: z.string().optional().nullable(),
      color: z.string().max(64).optional().nullable(),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const [proj] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, parsed.projectId));
  if (!proj) return JSON.stringify({ error: "Project not found" });
  try {
    await assertCanAccessProject(db, requireActor(handlers).actorUserId, parsed.projectId, "write");
  } catch (err) {
    if (err instanceof OwnershipAccessError) return accessDeniedMessage();
    throw err;
  }
  const fields: Record<string, unknown> = { title: parsed.title };
  if (parsed.description !== undefined) fields.description = parsed.description;
  if (parsed.dueDate !== undefined && parsed.dueDate !== null) fields.dueDate = parsed.dueDate;
  if (parsed.color !== undefined) fields.color = parsed.color;
  const proposal: AssistantProposal = {
    id: proposalId(),
    action: "create",
    entityType: "task",
    projectId: parsed.projectId,
    summary: parsed.summary,
    fields,
    method: "POST",
    path: `/api/v1/projects/${parsed.projectId}/tasks`,
  };
  handlers.onProposal?.(proposal);
  return JSON.stringify({
    ok: true,
    proposalId: proposal.id,
    message: "Create proposal sent to the user for confirmation. Do not claim it was saved.",
  });
}
