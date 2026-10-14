import { formatEntityRef, parseEntityRefToken } from "../../../lib/entityRef.js";
import type { TaskPriority } from "../../../lib/taskFields.js";
import type { TierOperation } from "../aiTiers.js";
import { resolveDatePhrase } from "./dates.js";
import type {
  CaptureChoice,
  CaptureExtraction,
  CaptureHit,
  CaptureLookup,
  CaptureLookupType,
  CaptureProposal,
  CaptureQuestion,
  CaptureRecordType,
  CaptureRef,
  ResolvedCapture,
} from "./types.js";

const PREFIX = /^\s*(to-?do|task|idea)\s*:\s*/i;
const TITLE_MAX = 500;
const TAG_MAX = 8;
const LINK_MAX = 5;

const PRIORITY_WORDS: Record<string, TaskPriority> = {
  none: "none",
  low: "low",
  medium: "medium",
  normal: "medium",
  high: "high",
  important: "high",
  urgent: "urgent",
  asap: "urgent",
};

export type ResolveCaptureInput = {
  text: string;
  extraction: CaptureExtraction;
  now: Date;
  timeZone: string;
  pageProject: CaptureHit | null;
  pageList: CaptureHit | null;
  lookup: CaptureLookup;
  /** Visible project for a list's project id. Display numbers are not ids. */
  projectById?: (projectId: number) => CaptureHit | null;
};

function refOf(hit: CaptureHit): CaptureRef {
  return {
    entityType: hit.entityType,
    id: hit.id,
    ref: formatEntityRef(hit.entityType, hit.number),
    title: hit.title,
    projectId: hit.projectId,
  };
}

function choicesOf(hits: CaptureHit[]): CaptureChoice[] {
  return hits
    .map((hit) => ({ ref: formatEntityRef(hit.entityType, hit.number), title: hit.title }))
    .sort((a, b) => a.ref.localeCompare(b.ref) || a.title.localeCompare(b.title));
}

function prefixType(text: string): CaptureRecordType | null {
  const match = PREFIX.exec(text);
  if (!match) return null;
  const word = match[1]!.toLowerCase();
  if (word === "task") return "task";
  if (word === "idea") return "idea";
  return "todo";
}

function cleanTitle(title: string): string {
  return title.replace(PREFIX, "").trim();
}

type Picked = { hit: CaptureHit | null; ambiguous: CaptureHit[] };

function pick(phrase: string, allowed: readonly CaptureLookupType[], lookup: CaptureLookup): Picked {
  const parsed = parseEntityRefToken(phrase);
  const hits = lookup(phrase).filter((hit) => allowed.includes(hit.entityType));
  if (parsed.entityType && parsed.number != null) {
    const exact = hits.filter(
      (hit) => hit.entityType === parsed.entityType && hit.number === parsed.number,
    );
    if (exact.length === 1) return { hit: exact[0]!, ambiguous: [] };
    return { hit: null, ambiguous: exact };
  }
  const needle = phrase.trim().toLowerCase();
  const exactTitle = hits.filter((hit) => hit.title.trim().toLowerCase() === needle);
  if (exactTitle.length === 1) return { hit: exactTitle[0]!, ambiguous: [] };
  if (exactTitle.length > 1) return { hit: null, ambiguous: exactTitle };
  if (hits.length === 1) return { hit: hits[0]!, ambiguous: [] };
  return { hit: null, ambiguous: hits };
}

function question(field: string, prompt: string, hits: CaptureHit[] = []): CaptureQuestion {
  const choices = choicesOf(hits);
  return choices.length > 0 ? { field, prompt, choices } : { field, prompt };
}

export function resolveCapture(input: ResolveCaptureInput): ResolvedCapture {
  const questions: CaptureQuestion[] = [];
  const forced = prefixType(input.text);
  let recordType: CaptureRecordType | null = forced ?? input.extraction.recordType;
  if (!recordType || (!forced && input.extraction.typeUnsure)) {
    recordType = forced ?? null;
    questions.push(question("recordType", "Which record type should this be: task, todo, or idea?"));
  }

  const title = cleanTitle(input.extraction.title);
  if (!title) {
    questions.push(question("title", "What should the title be?"));
  } else if (title.length > TITLE_MAX) {
    questions.push(question("title", "The title is too long."));
  }

  let description = input.extraction.description;
  if (description && description.length > 8_000) {
    questions.push(question("description", "The description is too long."));
    description = description.slice(0, 8_000);
  }

  let priority = input.extraction.priority;
  if (input.extraction.priorityUnsure) {
    priority = null;
    questions.push(question("priority", "Which priority should this use?"));
  } else if (typeof input.extraction.priority === "string") {
    const mapped = PRIORITY_WORDS[input.extraction.priority];
    priority = mapped ?? null;
    if (!mapped) questions.push(question("priority", "Which priority should this use?"));
  }

  let dueDate: string | null = null;
  if (input.extraction.datePhrase) {
    const resolved = resolveDatePhrase(input.extraction.datePhrase, input.now, input.timeZone);
    if (resolved.kind === "date") dueDate = resolved.iso;
    if (resolved.kind === "question") {
      questions.push({
        field: "dueDate",
        prompt: resolved.prompt,
        choices: resolved.choices,
      });
    }
  } else if (input.extraction.dateUnsure) {
    questions.push(question("dueDate", "Which date should this use?"));
  }

  let project = input.extraction.project
    ? pick(input.extraction.project, ["project"], input.lookup)
    : { hit: input.pageProject, ambiguous: [] as CaptureHit[] };
  if (input.extraction.project) {
    if (!project.hit) {
      questions.push(
        question(
          "project",
          project.ambiguous.length > 0
            ? "Which project did you mean?"
            : "No project matches that name.",
          project.ambiguous,
        ),
      );
    }
  }

  let list = input.extraction.list
    ? pick(input.extraction.list, ["todo_list"], input.lookup)
    : { hit: null as CaptureHit | null, ambiguous: [] as CaptureHit[] };
  if (input.extraction.list) {
    if (!list.hit) {
      questions.push(
        question(
          "list",
          list.ambiguous.length > 0 ? "Which list did you mean?" : "No list matches that name.",
          list.ambiguous,
        ),
      );
    }
  } else if (recordType === "todo" && input.pageList) {
    const pageProjectId = project.hit?.id ?? null;
    if (input.pageList.projectId == null || pageProjectId == null || input.pageList.projectId === pageProjectId) {
      list = { hit: input.pageList, ambiguous: [] };
    }
  }

  if (list.hit?.projectId != null && project.hit && list.hit.projectId !== project.hit.id) {
    questions.push(question("list", "That list is in a different project."));
  }
  if (!input.extraction.project && !project.hit && list.hit?.projectId != null) {
    const match = input.projectById?.(list.hit.projectId) ?? null;
    if (match?.entityType === "project") project = { hit: match, ambiguous: [] };
  }

  let parent: Picked = { hit: null, ambiguous: [] };
  if (input.extraction.parent) {
    parent = pick(input.extraction.parent, ["task"], input.lookup);
    if (!parent.hit) {
      questions.push(
        question(
          "parent",
          parent.ambiguous.length > 0 ? "Which task should be the parent?" : "No task matches that parent.",
          parent.ambiguous,
        ),
      );
    }
  }

  const links: CaptureRef[] = [];
  const linkPhrases = input.extraction.links.slice(0, LINK_MAX + 1);
  if (input.extraction.links.length > LINK_MAX) {
    questions.push(question("links", "Name up to five records to link."));
  }
  for (const phrase of linkPhrases.slice(0, LINK_MAX)) {
    const picked = pick(phrase, ["task", "todo", "idea", "project", "document"], input.lookup);
    if (picked.hit) links.push(refOf(picked.hit));
    else {
      questions.push(
        question(
          "links",
          picked.ambiguous.length > 0 ? `Which record matches “${phrase}”?` : `No record matches “${phrase}”.`,
          picked.ambiguous,
        ),
      );
    }
  }

  const tags: string[] = [];
  const seenTags = new Set<string>();
  for (const tag of input.extraction.tags) {
    const trimmed = tag.trim();
    if (!trimmed || trimmed.length > 40) {
      questions.push(question("tags", "Each tag needs a name of 40 characters or fewer."));
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seenTags.has(key)) continue;
    seenTags.add(key);
    tags.push(trimmed);
  }
  if (tags.length > TAG_MAX) {
    questions.push(question("tags", "Use at most eight tags."));
  }

  if (recordType === "idea") {
    if (input.extraction.datePhrase || input.extraction.dateUnsure) {
      questions.push(question("dueDate", "Ideas do not have a due date."));
      dueDate = null;
    }
    if (input.extraction.priority || input.extraction.priorityUnsure) {
      questions.push(question("priority", "Ideas do not have a priority."));
      priority = null;
    }
    if (input.extraction.project || input.extraction.list || input.extraction.parent) {
      questions.push(question("project", "Ideas are not filed under a project, list, or parent task."));
    }
  }
  if (recordType === "todo" && input.extraction.parent) {
    questions.push(question("parent", "A parent applies to a task."));
  }
  if (recordType === "task" && input.extraction.list) {
    questions.push(question("list", "A list applies to a todo."));
  }
  if (recordType === "task" && parent.hit && project.hit && parent.hit.projectId != null && parent.hit.projectId !== project.hit.id) {
    questions.push(question("parent", "That parent task is in a different project."));
  }

  const proposal: CaptureProposal = {
    recordType,
    title,
    description,
    dueDate: recordType === "idea" ? null : dueDate,
    priority: recordType === "idea" ? null : priority,
    project: recordType === "idea" ? null : project.hit ? refOf(project.hit) : null,
    list: recordType === "todo" && list.hit ? refOf(list.hit) : null,
    tags: tags.slice(0, TAG_MAX),
    parent: recordType === "task" && parent.hit ? refOf(parent.hit) : null,
    links,
  };

  return {
    proposal,
    questions,
    confirmable: questions.length === 0 && proposal.recordType != null && proposal.title.length > 0,
  };
}

export function captureOperations(proposal: CaptureProposal, actorUserId: number): TierOperation[] {
  if (!proposal.recordType || !proposal.title) return [];
  const fields: Record<string, unknown> = { title: proposal.title };
  if (proposal.description) fields.description = proposal.description;
  if (proposal.dueDate) fields.dueDate = proposal.dueDate;
  if (proposal.priority) fields.priority = proposal.priority;
  if (proposal.project) fields.projectId = proposal.project.id;
  if (proposal.parent) fields.parentId = proposal.parent.id;
  if (proposal.tags.length > 0) fields.tags = proposal.tags;
  if (proposal.list) fields.listId = proposal.list.id;
  const operations: TierOperation[] = [
    {
      action: "propose_create",
      entityType: proposal.recordType,
      projectId: proposal.project?.id ?? null,
      actorUserId,
      fields,
    },
  ];
  for (const tag of proposal.tags) {
    operations.push({
      action: "tag",
      entityType: proposal.recordType,
      projectId: proposal.project?.id ?? null,
      actorUserId,
      fields: { name: tag },
    });
  }
  for (const link of proposal.links) {
    operations.push({
      action: "link",
      entityType: link.entityType,
      entityId: link.id,
      projectId: link.projectId,
      actorUserId,
      fields: { entityType: link.entityType, entityId: link.id },
    });
  }
  return operations;
}

export function lookupFromHits(hits: CaptureHit[]): CaptureLookup {
  return (phrase: string) => {
    const parsed = parseEntityRefToken(phrase);
    const needle = phrase.trim().toLowerCase();
    return hits.filter((hit) => {
      if (parsed.entityType && parsed.number != null) {
        return hit.entityType === parsed.entityType && hit.number === parsed.number;
      }
      const title = hit.title.trim().toLowerCase();
      return title === needle || title.includes(needle);
    });
  };
}
