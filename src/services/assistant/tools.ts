import type { AiToolDefinition } from "@taskmesh/ai-provider-contract";
import { and, asc, desc, eq, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { ilikeEscaped } from "../../lib/ilike.js";
import type { AiAuditSink } from "./aiAudit.js";
import { writeAiAudit } from "./aiAudit.js";
import {
  check,
  tierForAction,
  type AiAction,
  type PolicyCheckInput,
  type PolicyDecision,
  type PolicyLayerFns,
} from "./aiPolicy.js";
import { loadActorAiPermission } from "./aiUserPolicy.js";
import type { AiPermissionSettings } from "./aiTiers.js";
import {
  attachProjectAiAccess,
  documentsVisibleToAi,
  projectIdForAiEntity,
  projectsVisibleToAi,
  resolveEffectiveAiAccess,
  resolveEffectiveLocalOnly,
  tasksVisibleToAi,
} from "./projectAiAccess.js";
import { todoListsVisibleToAi, todosVisibleToAi } from "./projectAiAccess.js";
import { capUrlQuery, fetchUrlForAssistant } from "./fetchUrl.js";
import { policyTargetForRegisteredTool } from "./toolRegistry.js";
import { toolUntrustedSource, withUntrustedFollowup, wrapUntrusted } from "./untrustedContent.js";
import {
  toolGetNeighbourhood,
  toolGetTodo,
  toolGetTodoList,
  toolListComments,
  toolListLinks,
  toolListTags,
  toolListTaskDependencies,
  toolListTodos,
  toolProposeComment,
  toolProposeLink,
  toolProposeTag,
  toolProposeTaskDependency,
  toolProposeTodoCreate,
  toolProposeTodoListCreate,
  toolProposeTodoListUpdate,
  toolProposeTodoUpdate,
} from "./expandedTools.js";
import {
  minimizeDocument,
  minimizeIdea,
  minimizeProject,
  minimizeTask,
  redactSecrets,
} from "./aiMinimize.js";
import type { EntityType } from "../../lib/entityType.js";
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
  /** Set for link, tag, and comment proposals so the tier matches the tool. */
  policyAction?: "link" | "tag" | "comment";
  entityType: "idea" | "project" | "document" | "task" | "todo" | "todo_list";
  /** Present for updates and for adds that target an existing record */
  entityId?: number;
  projectId?: number;
  summary: string;
  fields: Record<string, unknown>;
  method: "POST" | "PATCH";
  path: string;
  /** Audit row for this tool call, so Apply / Dismiss can attach a quality signal. */
  auditId?: number;
  /** Current values of the proposed keys. Present on updates. */
  before?: Record<string, unknown>;
  /** Target `updatedAt` when the proposal was made. */
  baseUpdatedAt?: string;
  /** The update target was already gone when the proposal was made. */
  targetMissing?: boolean;
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
  /** Administrator switch. Omitted or false denies `web_fetch`. */
  webFetchEnabled?: boolean;
  /** Page context or a read-tool result is already in this turn. */
  privateRecordsInTurn?: boolean;
  /** This turn was routed to a local model. Cloud turns cannot touch a local-only project. */
  routeLocalOnly?: boolean;
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
      description: "Search ideas, projects, tasks, documents, todos, and todo lists by text query.",
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
      description: "Load one idea, project, document, task, todo, or todo list by id.",
      parameters: {
        type: "object",
        properties: {
          entityType: {
            type: "string",
            enum: ["idea", "project", "document", "task", "todo", "todo_list"],
          },
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
        "Propose updating an existing task. Does not save; the user must confirm in the UI. State changes must follow the task workflow. Cancel, reopen, and returning In Progress to Ready require stateComment. Pending and Deleted cannot be set. Complete, Canceled, and Deleted tasks reject field edits.",
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
              "Next state only: Draft to Ready or Canceled; Ready to In Progress or Canceled; In Progress to Ready, On Hold, or Complete; On Hold to In Progress or Complete; Complete or Canceled to Ready for a project Owner, Manager, or Administrator.",
          },
          stateComment: {
            type: "string",
            description: "Required when canceling, reopening, or returning In Progress to Ready.",
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
  {
    type: "function" as const,
    function: {
      name: "list_todos",
      description: "List todos the user can see. Optional project, list, or title query.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "integer" },
          listId: { type: "integer" },
          q: { type: "string", description: "Title search" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_links",
      description: "List links touching one record. Returns the other end, relation, and direction.",
      parameters: {
        type: "object",
        properties: {
          entityType: {
            type: "string",
            enum: ["idea", "project", "task", "document", "todo", "todo_list"],
          },
          entityId: { type: "integer" },
        },
        required: ["entityType", "entityId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_tags",
      description: "List tag names on one idea, project, task, document, or todo.",
      parameters: {
        type: "object",
        properties: {
          entityType: {
            type: "string",
            enum: ["idea", "project", "task", "document", "todo", "todo_list"],
          },
          entityId: { type: "integer" },
        },
        required: ["entityType", "entityId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_comments",
      description: "List recent comments on a task, todo, or todo list.",
      parameters: {
        type: "object",
        properties: {
          entityType: { type: "string", enum: ["task", "todo", "todo_list"] },
          entityId: { type: "integer" },
        },
        required: ["entityType", "entityId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_task_dependencies",
      description: "List tasks this task depends on and tasks that depend on it.",
      parameters: {
        type: "object",
        properties: { taskId: { type: "integer" } },
        required: ["taskId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_neighbourhood",
      description:
        "Read the graph neighbourhood of one record (depth 1–3, default 2). Returns node keys, titles, and states, plus edges. Does not find a path between two records.",
      parameters: {
        type: "object",
        properties: {
          entityType: {
            type: "string",
            enum: ["idea", "project", "task", "document", "todo", "todo_list"],
          },
          entityId: { type: "integer" },
          depth: { type: "integer", description: "1 to 3. Default 2." },
          rel: { type: "string", description: "Comma-separated relation names. Omit for the default set." },
          hideDone: { type: "boolean" },
        },
        required: ["entityType", "entityId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_todo_create",
      description:
        "Propose creating a todo. Does not save; the user must confirm. Include state and progress only when the user asked for them.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
          state: { type: "string" },
          priority: { type: "string" },
          progress: { type: "integer", description: "0–100" },
          projectId: { type: "integer" },
          summary: { type: "string" },
        },
        required: ["title", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_todo_update",
      description:
        "Propose updating a todo, including state and progress. Does not save; the user must confirm. Progress on a parent with sub-items is derived.",
      parameters: {
        type: "object",
        properties: {
          todoId: { type: "integer" },
          title: { type: "string" },
          description: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD or null to clear" },
          state: { type: "string" },
          priority: { type: "string" },
          progress: { type: "integer", description: "0–100" },
          summary: { type: "string" },
        },
        required: ["todoId", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_todo_list_create",
      description: "Propose creating a todo list. Does not save; the user must confirm.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          projectId: { type: "integer" },
          summary: { type: "string" },
        },
        required: ["title", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_todo_list_update",
      description: "Propose renaming a todo list. Does not save; the user must confirm.",
      parameters: {
        type: "object",
        properties: {
          listId: { type: "integer" },
          title: { type: "string" },
          summary: { type: "string" },
        },
        required: ["listId", "title", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_link",
      description:
        "Propose a manual link between two records. Does not save; the user must confirm. Cannot remove a link.",
      parameters: {
        type: "object",
        properties: {
          srcType: {
            type: "string",
            enum: ["idea", "project", "task", "document", "todo", "todo_list"],
          },
          srcId: { type: "integer" },
          dstType: {
            type: "string",
            enum: ["idea", "project", "task", "document", "todo", "todo_list"],
          },
          dstId: { type: "integer" },
          relation: {
            type: "string",
            enum: ["relates_to", "references", "supports", "part_of"],
          },
          summary: { type: "string" },
        },
        required: ["srcType", "srcId", "dstType", "dstId", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_tag",
      description:
        "Propose adding a tag by name to an idea, project, task, document, or todo. Does not save; the user must confirm. Cannot remove a tag.",
      parameters: {
        type: "object",
        properties: {
          entityType: { type: "string", enum: ["idea", "project", "task", "document", "todo"] },
          entityId: { type: "integer" },
          name: { type: "string" },
          summary: { type: "string" },
        },
        required: ["entityType", "entityId", "name", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_comment",
      description:
        "Propose a comment on a task, todo, or todo list. Does not save; the user must confirm.",
      parameters: {
        type: "object",
        properties: {
          entityType: { type: "string", enum: ["task", "todo", "todo_list"] },
          entityId: { type: "integer" },
          body: { type: "string" },
          summary: { type: "string" },
        },
        required: ["entityType", "entityId", "body", "summary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_task_dependency",
      description:
        "Propose that one task depends on another. Does not save; the user must confirm. Cannot remove a dependency.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "integer", description: "The task that is blocked" },
          dependsOnTaskId: { type: "integer", description: "The task it depends on" },
          projectId: { type: "integer" },
          summary: { type: "string" },
        },
        required: ["taskId", "dependsOnTaskId", "summary"],
      },
    },
  },
];

export function assistantToolDefinitions(options?: {
  webFetchEnabled?: boolean;
}): AiToolDefinition[] {
  const tools = options?.webFetchEnabled
    ? OPENAI_TOOLS
    : OPENAI_TOOLS.filter((tool) => tool.function.name !== "fetch_url");
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters as Record<string, unknown>,
  }));
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

function policyTargetForTool(name: string, args: unknown): ToolPolicyTarget | null {
  return policyTargetForRegisteredTool(name, args);
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

function policyFields(args: unknown): Record<string, unknown> | null {
  if (!args || typeof args !== "object") return null;
  const rec = args as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(rec, "ownerId")) fields.ownerId = rec.ownerId;
  if (Object.prototype.hasOwnProperty.call(rec, "aiAccess")) fields.aiAccess = rec.aiAccess;
  if (Object.prototype.hasOwnProperty.call(rec, "ai_access")) fields.ai_access = rec.ai_access;
  if (Object.prototype.hasOwnProperty.call(rec, "aiLocalOnly")) fields.aiLocalOnly = rec.aiLocalOnly;
  if (Object.prototype.hasOwnProperty.call(rec, "ai_local_only")) fields.ai_local_only = rec.ai_local_only;
  const nested = rec.fields;
  if (nested && typeof nested === "object") {
    const inner = nested as Record<string, unknown>;
    if (typeof inner.projectId === "number") fields.projectId = inner.projectId;
    if (Object.prototype.hasOwnProperty.call(inner, "ownerId")) fields.ownerId = inner.ownerId;
    if (Object.prototype.hasOwnProperty.call(inner, "aiAccess")) fields.aiAccess = inner.aiAccess;
    if (Object.prototype.hasOwnProperty.call(inner, "ai_access")) fields.ai_access = inner.ai_access;
    if (Object.prototype.hasOwnProperty.call(inner, "aiLocalOnly")) fields.aiLocalOnly = inner.aiLocalOnly;
    if (Object.prototype.hasOwnProperty.call(inner, "ai_local_only")) fields.ai_local_only = inner.ai_local_only;
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

async function localOnlyRouteDenial(
  handlers: ToolHandlers,
  input: PolicyCheckInput,
): Promise<PolicyDecision | null> {
  if (handlers.routeLocalOnly === true) return null;
  const ids: number[] = [];
  if (typeof input.projectId === "number") ids.push(input.projectId);
  const dest = input.fields?.projectId;
  if (typeof dest === "number" && !ids.includes(dest)) ids.push(dest);
  for (const projectId of ids) {
    const local = await resolveEffectiveLocalOnly(db, projectId);
    if (local !== true) continue;
    return {
      decision: "deny",
      tier: tierForAction(input.action),
      reason: "Project is limited to local models",
    };
  }
  return null;
}

async function excludedReadDenial(projectId: number | null | undefined): Promise<string | null> {
  if (projectId == null) return null;
  const access = await resolveEffectiveAiAccess(db, projectId);
  if (access !== "excluded") return null;
  return denialPayload("read", {
    decision: "deny",
    tier: tierForAction("read"),
    reason: "Project is excluded from AI",
  });
}

async function auditTool(
  handlers: ToolHandlers,
  name: string,
  target: ToolPolicyTarget,
  decision: PolicyDecision,
  startedAt: number,
  reasonOverride?: string,
): Promise<number | null> {
  return writeAiAudit(
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
      reason: withUntrustedFollowup(
        target.action,
        reasonOverride ?? decision.reason,
        handlers.privateRecordsInTurn === true,
      ),
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
    case "list_todos":
      return await toolListTodos(args, handlers);
    case "list_links":
      return await toolListLinks(args, handlers);
    case "list_tags":
      return await toolListTags(args, handlers);
    case "list_comments":
      return await toolListComments(args, handlers);
    case "list_task_dependencies":
      return await toolListTaskDependencies(args, handlers);
    case "get_neighbourhood":
      return await toolGetNeighbourhood(args, handlers);
    case "propose_todo_create":
      return await toolProposeTodoCreate(args, handlers);
    case "propose_todo_update":
      return await toolProposeTodoUpdate(args, handlers);
    case "propose_todo_list_create":
      return await toolProposeTodoListCreate(args, handlers);
    case "propose_todo_list_update":
      return await toolProposeTodoListUpdate(args, handlers);
    case "propose_link":
      return await toolProposeLink(args, handlers);
    case "propose_tag":
      return await toolProposeTag(args, handlers);
    case "propose_comment":
      return await toolProposeComment(args, handlers);
    case "propose_task_dependency":
      return await toolProposeTaskDependency(args, handlers);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

export async function executeAssistantTool(
  name: string,
  argsJson: string,
  handlers: ToolHandlers = {},
): Promise<string> {
  const raw = await executeAssistantToolInner(name, argsJson, handlers);
  return wrapUntrusted(redactSecrets(raw), toolUntrustedSource(name));
}

async function executeAssistantToolInner(
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

  let resolvedTarget = target;
  if (resolvedTarget.projectId == null && resolvedTarget.entityId != null && resolvedTarget.entityType) {
    const projectId = await projectIdForAiEntity(
      db,
      resolvedTarget.entityType,
      resolvedTarget.entityId,
    );
    if (projectId != null) resolvedTarget = { ...resolvedTarget, projectId };
  }

  let actorSettings: AiPermissionSettings | undefined;
  let actorOff: readonly string[] | undefined;
  if (!handlers.checkPolicy && handlers.actorUserId) {
    const loaded = await loadActorAiPermission(db, handlers.actorUserId);
    actorSettings = loaded.settings;
    actorOff = loaded.off;
  }
  const decide = handlers.checkPolicy ?? ((input: PolicyCheckInput) => check(input, undefined, actorSettings));
  const policyInput = await attachProjectAiAccess(db, {
    actorUserId: handlers.actorUserId ?? 0,
    feature: handlers.feature ?? "assistant",
    action: resolvedTarget.action,
    entityType: resolvedTarget.entityType,
    resource: resolvedTarget.resource,
    entityId: resolvedTarget.entityId,
    projectId: resolvedTarget.projectId,
    fields: policyFields(args),
    webFetchEnabled: handlers.webFetchEnabled === true,
    privateRecordsInTurn: handlers.privateRecordsInTurn === true,
    userOff: actorOff,
  });
  const localDenial = await localOnlyRouteDenial(handlers, policyInput);
  if (localDenial) {
    await auditTool(handlers, name, resolvedTarget, localDenial, started);
    return denialPayload(resolvedTarget.action, localDenial);
  }
  const decision = decide(policyInput);

  if (decision.decision === "deny") {
    await auditTool(handlers, name, resolvedTarget, decision, started);
    return denialPayload(resolvedTarget.action, decision);
  }

  const fetched =
    decision.decision === "allow" && target.action === "web_fetch"
      ? fetchedUrlReason(args)
      : undefined;
  const pending: AssistantProposal[] = [];
  const wrapped: ToolHandlers = {
    ...handlers,
    onProposal: (proposal) => {
      pending.push(proposal);
    },
  };
  const emitPending = (auditId: number | null) => {
    for (const proposal of pending) {
      handlers.onProposal?.({ ...proposal, auditId: auditId ?? undefined });
    }
  };

  try {
    const result = redactSecrets(await dispatchTool(name, args, wrapped));
    const auditId = await auditTool(handlers, name, resolvedTarget, decision, started, fetched);
    emitPending(auditId);
    return result;
  } catch (err) {
    const auditId = await auditTool(handlers, name, resolvedTarget, decision, started, fetched);
    emitPending(auditId);
    return redactSecrets(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Tool failed",
      }),
    );
  }
}

function fetchedUrlReason(args: unknown): string {
  const raw = args && typeof args === "object" ? (args as { url?: unknown }).url : null;
  const capped = typeof raw === "string" ? capUrlQuery(raw) : "";
  const line = `Fetched ${capped}`;
  return line.length > 500 ? `${line.slice(0, 500)}…` : line;
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
  const [ideaScope, visibleProjects, visibleTasks, visibleDocuments, visibleTodos, visibleLists] =
    await Promise.all([
    Promise.resolve(ownerScope(schema.ideas.ownerId, actorUserId, isAdministrator)),
    projectsVisibleToAi(db, handlers.routeLocalOnly === true),
    tasksVisibleToAi(db, handlers.routeLocalOnly === true),
    documentsVisibleToAi(db, handlers.routeLocalOnly === true),
    todosVisibleToAi(db, handlers.routeLocalOnly === true),
    todoListsVisibleToAi(db, handlers.routeLocalOnly === true),
  ]);
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
  const todoScope = dualScopeListFilter(
    db,
    schema.todos.projectId,
    schema.todos.ownerId,
    actorUserId,
    isAdministrator,
  );
  const listScope = dualScopeListFilter(
    db,
    schema.todoLists.projectId,
    schema.todoLists.ownerId,
    actorUserId,
    isAdministrator,
  );
  const [ideas, projects, tasks, documents, todos, lists] = await Promise.all([
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
          visibleProjects,
        ),
      )
      .orderBy(desc(schema.projects.updatedAt))
      .limit(8),
    db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        projectId: schema.tasks.projectId,
        number: schema.tasks.number,
      })
      .from(schema.tasks)
      .where(
        and(
          ne(schema.tasks.state, "deleted"),
          or(ilikeEscaped(schema.tasks.title, q), ilikeEscaped(schema.tasks.description, q)),
          taskScope ?? sql`true`,
          visibleTasks,
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
          visibleDocuments,
        ),
      )
      .orderBy(desc(schema.projectDocuments.updatedAt))
      .limit(8),
    db
      .select({
        id: schema.todos.id,
        title: schema.todos.title,
        projectId: schema.todos.projectId,
        number: schema.todos.number,
      })
      .from(schema.todos)
      .where(
        and(
          ne(schema.todos.state, "deleted"),
          or(ilikeEscaped(schema.todos.title, q), ilikeEscaped(schema.todos.description, q)),
          todoScope ?? sql`true`,
          visibleTodos,
        ),
      )
      .orderBy(desc(schema.todos.updatedAt))
      .limit(8),
    db
      .select({
        id: schema.todoLists.id,
        title: schema.todoLists.title,
        projectId: schema.todoLists.projectId,
        number: schema.todoLists.number,
      })
      .from(schema.todoLists)
      .where(and(ilikeEscaped(schema.todoLists.title, q), listScope ?? sql`true`, visibleLists))
      .orderBy(desc(schema.todoLists.updatedAt))
      .limit(8),
  ]);
  return JSON.stringify({
    ideas: ideas.map((row) => ({ id: row.id, title: row.title })),
    projects: projects.map((row) => ({ id: row.id, name: row.name })),
    tasks: tasks.map((row) => ({
      id: row.id,
      title: row.title,
      number: row.number,
      projectId: row.projectId,
    })),
    documents: documents.map((row) => ({
      id: row.id,
      title: row.title,
      projectId: row.projectId,
    })),
    todos: todos.map((row) => ({
      id: row.id,
      title: row.title,
      number: row.number,
      projectId: row.projectId,
    })),
    todoLists: lists.map((row) => ({
      id: row.id,
      title: row.title,
      number: row.number,
      projectId: row.projectId,
    })),
  });
}

async function tagNames(entityType: EntityType, entityId: number): Promise<string[]> {
  const rows = await db
    .select({ name: schema.tags.name })
    .from(schema.taggings)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.taggings.tagId))
    .where(and(eq(schema.taggings.entityType, entityType), eq(schema.taggings.entityId, entityId)))
    .orderBy(asc(schema.tags.name));
  return rows.map((row) => row.name);
}

async function toolGetEntity(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      entityType: z.enum(["idea", "project", "document", "task", "todo", "todo_list"]),
      entityId: z.number().int().positive(),
    })
    .parse(args);
  const { actorUserId } = requireActor(handlers);

  try {
    if (parsed.entityType === "idea") {
      const [row] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, parsed.entityId));
      if (!row) return JSON.stringify({ error: "Idea not found" });
      await assertCanAccessOwned(db, actorUserId, row.ownerId);
      return JSON.stringify(
        minimizeIdea({ ...row, tags: await tagNames("idea", row.id) }),
      );
    }
    if (parsed.entityType === "project") {
      const row = await assertCanAccessProject(db, actorUserId, parsed.entityId);
      const hidden = await excludedReadDenial(row.id);
      if (hidden) return hidden;
      return JSON.stringify(
        minimizeProject({ ...row, tags: await tagNames("project", row.id) }),
      );
    }
    if (parsed.entityType === "document") {
      const [row] = await db
        .select()
        .from(schema.projectDocuments)
        .where(eq(schema.projectDocuments.id, parsed.entityId));
      if (!row) return JSON.stringify({ error: "Document not found" });
      await assertCanAccessProject(db, actorUserId, row.projectId);
      const hidden = await excludedReadDenial(row.projectId);
      if (hidden) return hidden;
      return JSON.stringify(
        minimizeDocument({ ...row, tags: await tagNames("document", row.id) }),
      );
    }
    if (parsed.entityType === "todo") {
      const hidden = await excludedReadDenial(
        await projectIdForAiEntity(db, "todo", parsed.entityId),
      );
      if (hidden) return hidden;
      return await toolGetTodo(parsed.entityId, actorUserId);
    }
    if (parsed.entityType === "todo_list") {
      const hidden = await excludedReadDenial(
        await projectIdForAiEntity(db, "todo_list", parsed.entityId),
      );
      if (hidden) return hidden;
      return await toolGetTodoList(parsed.entityId, actorUserId);
    }
    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, parsed.entityId));
    if (!row) return JSON.stringify({ error: "Task not found" });
    await assertCanAccessDualScoped(db, actorUserId, row);
    const hidden = await excludedReadDenial(row.projectId);
    if (hidden) return hidden;
    return JSON.stringify(
      minimizeTask({ ...row, tags: await tagNames("task", row.id) }),
    );
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
    const hidden = await excludedReadDenial(projectId);
    if (hidden) return hidden;
    const [docs, tasks] = await Promise.all([
      db
        .select({ id: schema.projectDocuments.id, title: schema.projectDocuments.title })
        .from(schema.projectDocuments)
        .where(eq(schema.projectDocuments.projectId, projectId))
        .orderBy(schema.projectDocuments.position)
        .limit(40),
      db
        .select({ id: schema.tasks.id, title: schema.tasks.title, number: schema.tasks.number })
        .from(schema.tasks)
        .where(eq(schema.tasks.projectId, projectId))
        .orderBy(schema.tasks.sortOrder)
        .limit(40),
    ]);
    return JSON.stringify({
      project: { id: proj.id, name: proj.name, status: proj.status },
      documents: docs.map((row) => ({ id: row.id, title: row.title })),
      tasks: tasks.map((row) => ({ id: row.id, title: row.title, number: row.number })),
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
