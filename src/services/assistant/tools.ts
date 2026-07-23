import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";

export type AssistantProposal = {
  id: string;
  entityType: "idea" | "document" | "task";
  entityId: number;
  projectId?: number;
  summary: string;
  fields: Record<string, unknown>;
  /** Path for client PATCH */
  patchPath: string;
};

export type ToolHandlers = {
  onTool?: (info: { name: string; args: unknown }) => void;
  onProposal?: (proposal: AssistantProposal) => void;
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
        "Propose updating a task. Does not save; the user must confirm in the UI.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "integer" },
          taskId: { type: "integer" },
          title: { type: "string" },
          notes: { type: "string" },
          dueAt: { type: "string", description: "ISO datetime or null to clear" },
          color: { type: "string" },
          summary: { type: "string" },
        },
        required: ["projectId", "taskId", "summary"],
      },
    },
  },
];

function clip(s: string, max = 4000): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function proposalId(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function executeAssistantTool(
  name: string,
  argsJson: string,
  handlers: ToolHandlers = {},
): Promise<string> {
  let args: unknown;
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return JSON.stringify({ error: "Invalid JSON arguments" });
  }
  handlers.onTool?.({ name, args });

  try {
    switch (name) {
      case "search_records":
        return await toolSearch(args);
      case "get_entity":
        return await toolGetEntity(args);
      case "list_project_context":
        return await toolListProject(args);
      case "propose_idea_update":
        return await toolProposeIdea(args, handlers);
      case "propose_document_update":
        return await toolProposeDocument(args, handlers);
      case "propose_task_update":
        return await toolProposeTask(args, handlers);
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : "Tool failed",
    });
  }
}

async function toolSearch(args: unknown): Promise<string> {
  const { q } = z.object({ q: z.string().min(1).max(200) }).parse(args);
  const pattern = `%${q}%`;
  const [ideas, projects, tasks, documents] = await Promise.all([
    db
      .select({ id: schema.ideas.id, title: schema.ideas.title })
      .from(schema.ideas)
      .where(or(ilike(schema.ideas.title, pattern), ilike(schema.ideas.body, pattern)))
      .orderBy(desc(schema.ideas.updatedAt))
      .limit(8),
    db
      .select({ id: schema.projects.id, name: schema.projects.name })
      .from(schema.projects)
      .where(
        or(ilike(schema.projects.name, pattern), ilike(schema.projects.description, pattern)),
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
      .where(or(ilike(schema.tasks.title, pattern), ilike(schema.tasks.notes, pattern)))
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
        or(
          ilike(schema.projectDocuments.title, pattern),
          ilike(schema.projectDocuments.body, pattern),
        ),
      )
      .orderBy(desc(schema.projectDocuments.updatedAt))
      .limit(8),
  ]);
  return JSON.stringify({ ideas, projects, tasks, documents });
}

async function toolGetEntity(args: unknown): Promise<string> {
  const parsed = z
    .object({
      entityType: z.enum(["idea", "project", "document", "task"]),
      entityId: z.number().int().positive(),
    })
    .parse(args);

  if (parsed.entityType === "idea") {
    const [row] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, parsed.entityId));
    if (!row) return JSON.stringify({ error: "Idea not found" });
    return JSON.stringify({
      type: "idea",
      id: row.id,
      title: row.title,
      body: clip(row.body ?? "", 8000),
    });
  }
  if (parsed.entityType === "project") {
    const [row] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, parsed.entityId));
    if (!row) return JSON.stringify({ error: "Project not found" });
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
  return JSON.stringify({
    type: "task",
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    notes: clip(row.notes ?? "", 4000),
    dueAt: row.dueAt?.toISOString() ?? null,
    color: row.color,
    phaseId: row.phaseId,
  });
}

async function toolListProject(args: unknown): Promise<string> {
  const { projectId } = z.object({ projectId: z.number().int().positive() }).parse(args);
  const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!proj) return JSON.stringify({ error: "Project not found" });
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
}

async function toolProposeIdea(args: unknown, handlers: ToolHandlers): Promise<string> {
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
  const fields: Record<string, unknown> = {};
  if (parsed.title !== undefined) fields.title = parsed.title;
  if (parsed.body !== undefined) fields.body = parsed.body;
  if (Object.keys(fields).length === 0) {
    return JSON.stringify({ error: "Provide title and/or body to update" });
  }
  const proposal: AssistantProposal = {
    id: proposalId(),
    entityType: "idea",
    entityId: parsed.ideaId,
    summary: parsed.summary,
    fields,
    patchPath: `/api/v1/ideas/${parsed.ideaId}`,
  };
  handlers.onProposal?.(proposal);
  return JSON.stringify({
    ok: true,
    proposalId: proposal.id,
    message: "Proposal sent to the user for confirmation. Do not claim it was saved.",
  });
}

async function toolProposeDocument(args: unknown, handlers: ToolHandlers): Promise<string> {
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
  const fields: Record<string, unknown> = {};
  if (parsed.title !== undefined) fields.title = parsed.title;
  if (parsed.body !== undefined) fields.body = parsed.body;
  if (Object.keys(fields).length === 0) {
    return JSON.stringify({ error: "Provide title and/or body to update" });
  }
  const proposal: AssistantProposal = {
    id: proposalId(),
    entityType: "document",
    entityId: parsed.documentId,
    projectId: parsed.projectId,
    summary: parsed.summary,
    fields,
    patchPath: `/api/v1/projects/${parsed.projectId}/documents/${parsed.documentId}`,
  };
  handlers.onProposal?.(proposal);
  return JSON.stringify({
    ok: true,
    proposalId: proposal.id,
    message: "Proposal sent to the user for confirmation. Do not claim it was saved.",
  });
}

async function toolProposeTask(args: unknown, handlers: ToolHandlers): Promise<string> {
  const parsed = z
    .object({
      projectId: z.number().int().positive(),
      taskId: z.number().int().positive(),
      title: z.string().min(1).max(2000).optional(),
      notes: z.string().max(50_000).optional().nullable(),
      dueAt: z.string().nullable().optional(),
      color: z.string().max(64).optional().nullable(),
      summary: z.string().min(1).max(500),
    })
    .parse(args);
  const [existing] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, parsed.taskId), eq(schema.tasks.projectId, parsed.projectId)));
  if (!existing) return JSON.stringify({ error: "Task not found" });
  const fields: Record<string, unknown> = {};
  if (parsed.title !== undefined) fields.title = parsed.title;
  if (parsed.notes !== undefined) fields.notes = parsed.notes;
  if (parsed.dueAt !== undefined) fields.dueAt = parsed.dueAt;
  if (parsed.color !== undefined) fields.color = parsed.color;
  if (Object.keys(fields).length === 0) {
    return JSON.stringify({ error: "Provide at least one field to update" });
  }
  const proposal: AssistantProposal = {
    id: proposalId(),
    entityType: "task",
    entityId: parsed.taskId,
    projectId: parsed.projectId,
    summary: parsed.summary,
    fields,
    patchPath: `/api/v1/projects/${parsed.projectId}/tasks/${parsed.taskId}`,
  };
  handlers.onProposal?.(proposal);
  return JSON.stringify({
    ok: true,
    proposalId: proposal.id,
    message: "Proposal sent to the user for confirmation. Do not claim it was saved.",
  });
}
