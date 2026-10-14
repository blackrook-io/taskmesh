import { and, asc, desc, eq } from "drizzle-orm";
import { decode, encode } from "gpt-tokenizer/encoding/cl100k_base";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { entityEndKey } from "../../lib/entityLinkRules.js";
import { formatEntityRef } from "../../lib/entityRef.js";
import type { EntityType } from "../../lib/entityType.js";
import { getSystemProperties } from "../systemProperties.js";
import { listEntityLinks, loadVisibleEnds, type LinkActor } from "../entityLinks.js";
import { userHasAdministrator } from "../roles.js";
import { resolveEffectiveAiAccess } from "./projectAiAccess.js";
import type { KnowledgeHit } from "../knowledge/search.js";
import { searchKnowledge } from "../knowledge/search.js";
import {
  excerptText,
  minimizeComment,
  minimizeDocument,
  minimizeIdea,
  minimizeLink,
  minimizeProject,
  minimizeTask,
  minimizeTodo,
  minimizeTodoList,
  redactSecrets,
} from "./aiMinimize.js";
import { wrapUntrusted } from "./untrustedContent.js";

export const AI_INSTRUCTIONS_MAX = 8_000;
export const DEFAULT_CONTEXT_BUDGET = 8_000;
export const MIN_CONTEXT_BUDGET = 256;
export const MAX_CONTEXT_BUDGET = 32_000;
const ACTIVITY_LIMIT = 8;
const HIT_LIMIT = 8;

const FEATURE_RE = /^[a-z0-9_]{1,40}$/;

export class ContextAssemblyError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ContextAssemblyError";
    this.status = status;
    this.code = code;
  }
}

export type ContextItem = {
  ref: string | null;
  section: string;
  tokens: number;
};

export type ContextDrop = {
  ref: string | null;
  section: string;
  reason: "truncated" | "budget";
};

export type AssembledContext = {
  text: string;
  estimatedTokens: number;
  budgetTokens: number;
  blocked: "project_excluded" | null;
  items: ContextItem[];
  dropped: ContextDrop[];
};

export type ContextRecord = {
  ref: string;
  title: string;
  body: string;
};

export type ContextHit = {
  id: number;
  ref: string;
  title: string;
  page: number | null;
  body: string;
  score: number;
};

export type ContextDraft = {
  feature: string;
  budgetTokens?: number;
  blocked?: "project_excluded" | null;
  instanceInstructions?: string | null;
  projectInstructions?: string | null;
  userInstructions?: string | null;
  focus?: ContextRecord | null;
  parent?: ContextRecord | null;
  links?: ContextRecord[];
  activity?: ContextRecord[];
  hits?: ContextHit[];
};

type Piece = {
  section: string;
  ref: string | null;
  source: string;
  inner: string;
  fence: boolean;
};

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

export function cleanAiInstructions(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, AI_INSTRUCTIONS_MAX);
}

export function resolveContextBudget(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CONTEXT_BUDGET;
  if (!Number.isInteger(value) || value < MIN_CONTEXT_BUDGET || value > MAX_CONTEXT_BUDGET) {
    throw new ContextAssemblyError(
      400,
      "invalid_budget",
      `budgetTokens must be an integer from ${MIN_CONTEXT_BUDGET} to ${MAX_CONTEXT_BUDGET}`,
    );
  }
  return value;
}

function assertFeature(feature: string): void {
  if (!FEATURE_RE.test(feature)) {
    throw new ContextAssemblyError(
      400,
      "invalid_feature",
      "feature must be 1–40 characters of lowercase letters, digits, or underscores",
    );
  }
}

function fenceSource(ref: string): string {
  return `ref:${ref.toLowerCase()}`;
}

function recordInner(ref: string, title: string, body: string, page?: number | null): string {
  const label = page != null ? `${ref} p.${page}` : ref;
  const head = title.trim() ? `[${label}] ${title.trim()}` : `[${label}]`;
  const payload = body.trim() ? `${head}\n${body.trim()}` : head;
  return redactSecrets(payload);
}

function instructionPiece(section: string, source: string, text: string | null | undefined): Piece | null {
  const cleaned = cleanAiInstructions(text);
  if (!cleaned) return null;
  return {
    section,
    ref: null,
    source,
    inner: redactSecrets(`[${source}]\n${cleaned}`),
    fence: true,
  };
}

function recordPiece(section: string, record: ContextRecord, page?: number | null): Piece {
  return {
    section,
    ref: record.ref,
    source: fenceSource(record.ref),
    inner: recordInner(record.ref, record.title, record.body, page),
    fence: true,
  };
}

/** Longest prefix of `inner` whose fenced form keeps the joined packet inside `budget`. */
function fitPiece(
  prev: string,
  piece: Piece,
  budget: number,
): { text: string; tokens: number; truncated: boolean } | null {
  const encoded = encode(piece.inner);
  let lo = 0;
  let hi = encoded.length;
  let best: { text: string; tokens: number; truncated: boolean } | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const sliced = decode(encoded.slice(0, mid));
    if (!sliced.trim()) {
      lo = mid + 1;
      continue;
    }
    const body = piece.fence ? wrapUntrusted(sliced, piece.source) : sliced;
    const candidate = prev.length ? `${prev}\n\n${body}` : body;
    const tokens = estimateTokens(candidate);
    if (tokens <= budget) {
      best = { text: candidate, tokens, truncated: mid < encoded.length };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Build a context packet from already-loaded pieces.
 * Same draft always yields the same text, items, and dropped list.
 */
export function renderContext(draft: ContextDraft): AssembledContext {
  assertFeature(draft.feature);
  const budgetTokens = resolveContextBudget(draft.budgetTokens);
  if (draft.blocked === "project_excluded") {
    return {
      text: "",
      estimatedTokens: 0,
      budgetTokens,
      blocked: "project_excluded",
      items: [],
      dropped: [],
    };
  }

  const pieces: Piece[] = [
    {
      section: "feature",
      ref: null,
      source: "feature",
      inner: `feature: ${draft.feature}`,
      fence: false,
    },
  ];
  const instance = instructionPiece(
    "instructions_instance",
    "instructions:instance",
    draft.instanceInstructions,
  );
  const project = instructionPiece(
    "instructions_project",
    "instructions:project",
    draft.projectInstructions,
  );
  const user = instructionPiece("instructions_user", "instructions:user", draft.userInstructions);
  if (instance) pieces.push(instance);
  if (project) pieces.push(project);
  if (user) pieces.push(user);
  if (draft.focus) pieces.push(recordPiece("focus", draft.focus));
  if (draft.parent) pieces.push(recordPiece("parent", draft.parent));

  const links = [...(draft.links ?? [])].sort((a, b) => {
    const ref = a.ref.localeCompare(b.ref);
    if (ref !== 0) return ref;
    return a.title.localeCompare(b.title);
  });
  for (const link of links) pieces.push(recordPiece("link", link));
  for (const row of draft.activity ?? []) pieces.push(recordPiece("activity", row));

  const hits = [...(draft.hits ?? [])]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ref = a.ref.localeCompare(b.ref);
      if (ref !== 0) return ref;
      return a.id - b.id;
    })
    .slice(0, HIT_LIMIT);
  for (const hit of hits) {
    pieces.push(
      recordPiece(
        "search",
        { ref: hit.ref, title: hit.title, body: hit.body },
        hit.page,
      ),
    );
  }

  let text = "";
  let estimatedTokens = 0;
  const items: ContextItem[] = [];
  const dropped: ContextDrop[] = [];
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    const fitted = fitPiece(text, piece, budgetTokens);
    if (!fitted) {
      for (const rest of pieces.slice(index)) {
        dropped.push({ ref: rest.ref, section: rest.section, reason: "budget" });
      }
      break;
    }
    const itemTokens = fitted.tokens - estimatedTokens;
    text = fitted.text;
    estimatedTokens = fitted.tokens;
    items.push({ ref: piece.ref, section: piece.section, tokens: itemTokens });
    if (fitted.truncated) {
      dropped.push({ ref: piece.ref, section: piece.section, reason: "truncated" });
      for (const rest of pieces.slice(index + 1)) {
        dropped.push({ ref: rest.ref, section: rest.section, reason: "budget" });
      }
      break;
    }
  }

  return {
    text,
    estimatedTokens,
    budgetTokens,
    blocked: null,
    items,
    dropped,
  };
}

type Actor = LinkActor;

async function tagNames(entityType: EntityType, entityId: number): Promise<string[]> {
  const rows = await db
    .select({ name: schema.tags.name })
    .from(schema.taggings)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.taggings.tagId))
    .where(and(eq(schema.taggings.entityType, entityType), eq(schema.taggings.entityId, entityId)))
    .orderBy(asc(schema.tags.name));
  return rows.map((row) => row.name);
}

async function minimizedBody(entityType: EntityType, entityId: number): Promise<string> {
  const tags = await tagNames(entityType, entityId);
  if (entityType === "idea") {
    const [row] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, entityId));
    if (!row) return "";
    return JSON.stringify(minimizeIdea({ ...row, tags }));
  }
  if (entityType === "project") {
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, entityId));
    if (!row) return "";
    return JSON.stringify(minimizeProject({ ...row, description: row.description, tags }));
  }
  if (entityType === "task") {
    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, entityId));
    if (!row) return "";
    return JSON.stringify(minimizeTask({ ...row, tags }));
  }
  if (entityType === "todo") {
    const [row] = await db.select().from(schema.todos).where(eq(schema.todos.id, entityId));
    if (!row) return "";
    return JSON.stringify(minimizeTodo({ ...row, tags }));
  }
  if (entityType === "document") {
    const [row] = await db
      .select()
      .from(schema.projectDocuments)
      .where(eq(schema.projectDocuments.id, entityId));
    if (!row) return "";
    return JSON.stringify(
      minimizeDocument({
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        body: row.body,
        tags,
      }),
    );
  }
  if (entityType === "todo_list") {
    const [row] = await db.select().from(schema.todoLists).where(eq(schema.todoLists.id, entityId));
    if (!row) return "";
    return JSON.stringify(minimizeTodoList(row));
  }
  if (entityType === "board") {
    const [row] = await db.select().from(schema.boards).where(eq(schema.boards.id, entityId));
    if (!row) return "";
    return JSON.stringify({ type: "board", id: row.id, projectId: row.projectId, name: row.name, tags });
  }
  if (entityType === "canvas") {
    const [row] = await db.select().from(schema.canvases).where(eq(schema.canvases.id, entityId));
    if (!row) return "";
    return JSON.stringify({ type: "canvas", id: row.id, projectId: row.projectId, title: row.title, tags });
  }
  if (entityType === "wiki_node") {
    const [row] = await db.select().from(schema.wikiNodes).where(eq(schema.wikiNodes.id, entityId));
    if (!row) return "";
    return JSON.stringify({ type: "wiki_node", id: row.id, projectId: row.projectId, title: row.title, tags });
  }
  const [row] = await db.select().from(schema.imageBoards).where(eq(schema.imageBoards.id, entityId));
  if (!row) return "";
  return JSON.stringify({ type: "image_board", id: row.id, projectId: row.projectId, title: row.title, tags });
}

async function visibleEnd(actor: Actor, entityType: EntityType, entityId: number) {
  const ends = await loadVisibleEnds(db, [{ entityType, id: entityId }], actor);
  return ends.get(entityEndKey(entityType, entityId)) ?? null;
}

async function toRecord(actor: Actor, entityType: EntityType, entityId: number): Promise<ContextRecord | null> {
  const end = await visibleEnd(actor, entityType, entityId);
  if (!end) return null;
  return {
    ref: end.referenceId,
    title: end.title,
    body: await minimizedBody(entityType, entityId),
  };
}

function activityBody(row: typeof schema.taskActivity.$inferSelect): string {
  if (row.kind === "comment") {
    return JSON.stringify(minimizeComment({ id: row.id, body: row.body, createdAt: row.createdAt }));
  }
  const summary =
    row.body?.trim() ||
    `${row.field ?? "change"}: ${row.oldValue ?? ""} → ${row.newValue ?? ""}`;
  return excerptText(summary);
}

export async function assembleContext(args: {
  actorId: number;
  feature: string;
  entityType: EntityType;
  entityId: number;
  query?: string;
  budgetTokens?: number;
  hits?: KnowledgeHit[];
}): Promise<AssembledContext> {
  assertFeature(args.feature);
  const budgetTokens = resolveContextBudget(args.budgetTokens);
  const isAdmin = await userHasAdministrator(db, args.actorId);
  const actor: Actor = { userId: args.actorId, isAdministrator: isAdmin };
  const focusEnd = await visibleEnd(actor, args.entityType, args.entityId);
  if (!focusEnd) {
    throw new ContextAssemblyError(404, "not_found", "Record not found");
  }

  const projectId = args.entityType === "project" ? args.entityId : focusEnd.projectId;
  if (projectId != null) {
    const access = await resolveEffectiveAiAccess(db, projectId);
    if (access === "excluded") {
      return renderContext({ feature: args.feature, budgetTokens, blocked: "project_excluded" });
    }
  }

  const props = await getSystemProperties(db);
  const [user] = await db
    .select({ aiInstructions: schema.users.aiInstructions })
    .from(schema.users)
    .where(eq(schema.users.id, args.actorId));
  let projectInstructions: string | null = null;
  if (projectId != null) {
    const [project] = await db
      .select({ aiInstructions: schema.projects.aiInstructions })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    projectInstructions = project?.aiInstructions ?? null;
  }

  const focus = await toRecord(actor, args.entityType, args.entityId);
  let parent: ContextRecord | null = null;
  if (args.entityType === "task") {
    const [task] = await db
      .select({ parentId: schema.tasks.parentId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, args.entityId));
    if (task?.parentId != null) parent = await toRecord(actor, "task", task.parentId);
  }
  if (!parent && args.entityType !== "project" && focusEnd.projectId != null) {
    parent = await toRecord(actor, "project", focusEnd.projectId);
  }

  const linkLists = await listEntityLinks(db, args.entityType, args.entityId, actor);
  const links: ContextRecord[] = [];
  const pushLink = (link: (typeof linkLists.outgoing)[number], direction: "outgoing" | "incoming") => {
    links.push({
      ref: link.entity.referenceId,
      title: link.entity.title,
      body: JSON.stringify(
        minimizeLink({
          id: link.id,
          relation: link.relation,
          origin: link.origin,
          direction,
          entityType: link.entity.entityType,
          entityId: link.entity.id,
          title: link.entity.title,
          referenceId: link.entity.referenceId,
        }),
      ),
    });
  };
  for (const link of linkLists.outgoing) pushLink(link, "outgoing");
  for (const link of linkLists.incoming) pushLink(link, "incoming");

  const activityRows = await db
    .select()
    .from(schema.taskActivity)
    .where(
      and(
        eq(schema.taskActivity.entityType, args.entityType),
        eq(schema.taskActivity.entityId, args.entityId),
      ),
    )
    .orderBy(desc(schema.taskActivity.createdAt), desc(schema.taskActivity.id))
    .limit(ACTIVITY_LIMIT);
  const activity: ContextRecord[] = focus
    ? activityRows.map((row) => ({
        ref: focus.ref,
        title: `activity ${row.id}`,
        body: activityBody(row),
      }))
    : [];

  const query = args.query?.trim() || focusEnd.title.trim();
  let rawHits = args.hits;
  if (!rawHits && query) {
    rawHits = await searchKnowledge({
      actorId: args.actorId,
      isAdmin,
      q: query,
      projectId: projectId ?? undefined,
      limit: HIT_LIMIT * 3,
    });
  }
  const hitEnds = await loadVisibleEnds(
    db,
    (rawHits ?? []).map((hit) => ({ entityType: hit.entityType, id: hit.entityId })),
    actor,
  );
  const hits: ContextHit[] = [];
  for (const hit of rawHits ?? []) {
    if (hit.entityType === args.entityType && hit.entityId === args.entityId) continue;
    const end = hitEnds.get(entityEndKey(hit.entityType, hit.entityId));
    if (!end) continue;
    hits.push({
      id: hit.id,
      ref: end.referenceId,
      title: hit.heading?.trim() || end.title,
      page: hit.locator,
      body: excerptText(hit.content),
      score: hit.score,
    });
  }

  return renderContext({
    feature: args.feature,
    budgetTokens,
    instanceInstructions: props.aiInstructions,
    projectInstructions,
    userInstructions: user?.aiInstructions ?? null,
    focus,
    parent,
    links,
    activity,
    hits,
  });
}
