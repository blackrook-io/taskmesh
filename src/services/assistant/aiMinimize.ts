/** Fields a model may see for one record, after secret redaction and excerpting. */

export const ENTITY_EXCERPT_MAX = 2_000;

const REPLACEMENT = "[redacted]";

/**
 * Secret-shaped strings. Order matters: longer key prefixes and blocks run
 * before the generic `sk-` and assignment patterns.
 */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s'"]+/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\b(?:password|pwd|api_key|apikey|token)\s*=\s*[^\s&'"]+/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REPLACEMENT);
  }
  return out;
}

export function excerptText(text: string, max = ENTITY_EXCERPT_MAX): string {
  const clean = redactSecrets(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}…`;
}

export type MinimizedIdea = {
  type: "idea";
  id: number;
  title: string;
  body: string;
  tags: string[];
};

export type MinimizedProject = {
  type: "project";
  id: number;
  name: string;
  description: string;
  status: string;
  tags: string[];
};

export type MinimizedDocument = {
  type: "document";
  id: number;
  projectId: number;
  title: string;
  body: string;
  tags: string[];
};

export type MinimizedTask = {
  type: "task";
  id: number;
  projectId: number | null;
  title: string;
  description: string;
  dueDate: string | null;
  number: number | null;
  state: string;
  priority: string | null;
  tags: string[];
};

export function minimizeIdea(row: {
  id: number;
  title: string;
  body?: string | null;
  tags?: string[];
}): MinimizedIdea {
  return {
    type: "idea",
    id: row.id,
    title: row.title,
    body: excerptText(row.body ?? ""),
    tags: row.tags ?? [],
  };
}

export function minimizeProject(row: {
  id: number;
  name: string;
  description?: string | null;
  status: string;
  tags?: string[];
}): MinimizedProject {
  return {
    type: "project",
    id: row.id,
    name: row.name,
    description: excerptText(row.description ?? ""),
    status: row.status,
    tags: row.tags ?? [],
  };
}

export function minimizeDocument(row: {
  id: number;
  projectId: number;
  title: string;
  body?: string | null;
  tags?: string[];
}): MinimizedDocument {
  return {
    type: "document",
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    body: excerptText(row.body ?? ""),
    tags: row.tags ?? [],
  };
}

export function minimizeTask(row: {
  id: number;
  projectId: number | null;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  number?: number | null;
  state: string;
  priority?: string | null;
  tags?: string[];
}): MinimizedTask {
  return {
    type: "task",
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: excerptText(row.description ?? ""),
    dueDate: row.dueDate ?? null,
    number: row.number ?? null,
    state: row.state,
    priority: row.priority ?? null,
    tags: row.tags ?? [],
  };
}
