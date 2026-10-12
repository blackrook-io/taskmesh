import { isEntityType, type EntityType } from "../../lib/entityType.js";
import { isFloorResource, type AiAction, type FloorResource } from "./aiPolicy.js";

export type ToolRegistration = {
  action: AiAction;
  /** Null when the tool is cross-type or the type comes from an argument. */
  entityType: EntityType | null;
  entityTypeArg?: string;
  entityIdArg?: string;
  projectIdArg?: string;
};

export type RegisteredPolicyTarget = {
  action: AiAction;
  entityType?: EntityType | null;
  resource?: FloorResource | null;
  entityId?: number | null;
  projectId?: number | null;
};

export const TOOL_REGISTRY: Record<string, ToolRegistration> = {
  search_records: { action: "read", entityType: null },
  get_entity: {
    action: "read",
    entityType: null,
    entityTypeArg: "entityType",
    entityIdArg: "entityId",
  },
  list_project_context: {
    action: "read",
    entityType: "project",
    projectIdArg: "projectId",
  },
  fetch_url: { action: "web_fetch", entityType: null },
  propose_idea_update: {
    action: "propose_update",
    entityType: "idea",
    entityIdArg: "ideaId",
  },
  propose_document_update: {
    action: "propose_update",
    entityType: "document",
    entityIdArg: "documentId",
    projectIdArg: "projectId",
  },
  propose_task_update: {
    action: "propose_update",
    entityType: "task",
    entityIdArg: "taskId",
    projectIdArg: "projectId",
  },
  propose_idea_create: { action: "propose_create", entityType: "idea" },
  propose_document_create: {
    action: "propose_create",
    entityType: "document",
    projectIdArg: "projectId",
  },
  propose_task_create: {
    action: "propose_create",
    entityType: "task",
    projectIdArg: "projectId",
  },
  list_todos: { action: "read", entityType: "todo", projectIdArg: "projectId" },
  list_links: {
    action: "read",
    entityType: null,
    entityTypeArg: "entityType",
    entityIdArg: "entityId",
  },
  list_tags: {
    action: "read",
    entityType: null,
    entityTypeArg: "entityType",
    entityIdArg: "entityId",
  },
  list_comments: {
    action: "read",
    entityType: null,
    entityTypeArg: "entityType",
    entityIdArg: "entityId",
  },
  list_task_dependencies: {
    action: "read",
    entityType: "task",
    entityIdArg: "taskId",
  },
  get_neighbourhood: {
    action: "read",
    entityType: null,
    entityTypeArg: "entityType",
    entityIdArg: "entityId",
  },
  propose_todo_create: {
    action: "propose_create",
    entityType: "todo",
    projectIdArg: "projectId",
  },
  propose_todo_update: {
    action: "propose_update",
    entityType: "todo",
    entityIdArg: "todoId",
  },
  propose_todo_list_create: {
    action: "propose_create",
    entityType: "todo_list",
    projectIdArg: "projectId",
  },
  propose_todo_list_update: {
    action: "propose_update",
    entityType: "todo_list",
    entityIdArg: "listId",
  },
  propose_link: {
    action: "link",
    entityType: null,
    entityTypeArg: "srcType",
    entityIdArg: "srcId",
  },
  propose_tag: {
    action: "tag",
    entityType: null,
    entityTypeArg: "entityType",
    entityIdArg: "entityId",
  },
  propose_comment: {
    action: "comment",
    entityType: null,
    entityTypeArg: "entityType",
    entityIdArg: "entityId",
  },
  propose_task_dependency: {
    action: "link",
    entityType: "task",
    entityIdArg: "taskId",
    projectIdArg: "projectId",
  },
};

function integerArg(args: unknown, key: string | undefined): number | null {
  if (!key || !args || typeof args !== "object") return null;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function policyTargetForRegisteredTool(
  name: string,
  args: unknown,
): RegisteredPolicyTarget | null {
  const row = TOOL_REGISTRY[name];
  if (!row) return null;
  let entityType: EntityType | null = row.entityType;
  let resource: FloorResource | null = null;
  if (row.entityTypeArg && args && typeof args === "object") {
    const raw = (args as Record<string, unknown>)[row.entityTypeArg];
    if (typeof raw === "string") {
      if (isEntityType(raw)) entityType = raw;
      else if (isFloorResource(raw)) resource = raw;
    }
  }
  return {
    action: row.action,
    entityType,
    resource,
    entityId: integerArg(args, row.entityIdArg),
    projectId: integerArg(args, row.projectIdArg),
  };
}
