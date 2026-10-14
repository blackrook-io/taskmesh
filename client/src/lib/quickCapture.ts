export const CAPTURE_LINE_LIMIT = 10;

export const CAPTURE_RECORD_TYPES = ["task", "todo", "idea"] as const;
export type CaptureRecordType = (typeof CAPTURE_RECORD_TYPES)[number];

export const CAPTURE_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type CapturePriority = (typeof CAPTURE_PRIORITIES)[number];

export type CaptureRef = {
  entityType: string;
  id: number;
  ref: string;
  title: string;
  projectId: number | null;
};

export type CaptureChoice = {
  ref: string;
  title: string;
  entityType?: string;
  id?: number;
};

export type CaptureQuestion = {
  field: string;
  prompt: string;
  choices?: CaptureChoice[];
};

export type CaptureProposal = {
  recordType: CaptureRecordType | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: CapturePriority | null;
  project: CaptureRef | null;
  list: CaptureRef | null;
  tags: string[];
  parent: CaptureRef | null;
  links: CaptureRef[];
};

export type CaptureResult = {
  proposal: CaptureProposal;
  questions: CaptureQuestion[];
  confirmable: boolean;
  denied: string | null;
};

export type CaptureDraft = {
  key: string;
  source: string;
  recordType: CaptureRecordType | null;
  title: string;
  description: string;
  dueDate: string;
  priority: CapturePriority | "";
  project: CaptureRef | null;
  list: CaptureRef | null;
  parent: CaptureRef | null;
  tags: string[];
  links: CaptureRef[];
  questions: CaptureQuestion[];
  denied: string | null;
  error: string | null;
  warnings: string[];
  saved: { entityType: CaptureRecordType; id: number; ref: string; href: string } | null;
};

export type CaptureConfirmBody = {
  recordType: CaptureRecordType;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: CapturePriority | null;
  projectId: number | null;
  listId: number | null;
  parentId: number | null;
  tags: string[];
  links: { entityType: string; id: number }[];
};

const OPTIONAL_LEAVE = new Set(["project", "list", "parent", "links", "dueDate", "priority", "description"]);

export function splitCaptureLines(text: string): { lines: string[]; remainder: string } {
  const parts = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  return {
    lines: parts.slice(0, CAPTURE_LINE_LIMIT),
    remainder: parts.slice(CAPTURE_LINE_LIMIT).join("\n"),
  };
}

export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && zone.length > 0 ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

export function listIdFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/todos\/(\d+)(?:\/|$)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

export function captureRecordHref(
  entityType: CaptureRecordType,
  id: number,
  projectId: number | null,
  listId: number | null,
): string {
  if (entityType === "idea") return `/ideas/${id}`;
  if (entityType === "todo") return listId != null ? `/todos/${listId}` : "/todos";
  return projectId != null ? `/projects/${projectId}` : "/tasks";
}

export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function choiceRef(choice: CaptureChoice): CaptureRef | null {
  if (choice.id == null || !choice.entityType) return null;
  return {
    entityType: choice.entityType,
    id: choice.id,
    ref: choice.ref,
    title: choice.title,
    projectId: null,
  };
}

function withoutQuestion(draft: CaptureDraft, field: string): CaptureQuestion[] {
  return draft.questions.filter((question) => question.field !== field);
}

function touched(draft: CaptureDraft, patch: Partial<CaptureDraft>): CaptureDraft {
  return { ...draft, denied: null, ...patch };
}

export function draftFromCapture(source: string, data: CaptureResult, key: string): CaptureDraft {
  const proposal = data.proposal;
  return {
    key,
    source,
    recordType: proposal.recordType,
    title: proposal.title,
    description: proposal.description ?? "",
    dueDate: proposal.dueDate ?? "",
    priority: proposal.priority ?? "",
    project: proposal.project,
    list: proposal.list,
    parent: proposal.parent,
    tags: proposal.tags,
    links: proposal.links,
    questions: data.questions,
    denied: data.denied,
    error: null,
    warnings: [],
    saved: null,
  };
}

export function errorDraft(source: string, message: string, key: string): CaptureDraft {
  return {
    key,
    source,
    recordType: null,
    title: "",
    description: "",
    dueDate: "",
    priority: "",
    project: null,
    list: null,
    parent: null,
    tags: [],
    links: [],
    questions: [],
    denied: null,
    error: message,
    warnings: [],
    saved: null,
  };
}

export function isConfirmable(draft: CaptureDraft): boolean {
  return (
    draft.saved == null &&
    draft.error == null &&
    draft.denied == null &&
    draft.recordType != null &&
    draft.title.trim().length > 0 &&
    draft.questions.length === 0
  );
}

export function confirmBodyOf(draft: CaptureDraft): CaptureConfirmBody | null {
  if (!isConfirmable(draft) || draft.recordType == null) return null;
  const idea = draft.recordType === "idea";
  return {
    recordType: draft.recordType,
    title: draft.title.trim(),
    description: draft.description.trim() ? draft.description.trim() : null,
    dueDate: idea || !draft.dueDate ? null : draft.dueDate,
    priority: idea || draft.priority === "" ? null : draft.priority,
    projectId: idea ? null : (draft.project?.id ?? null),
    listId: draft.recordType === "todo" ? (draft.list?.id ?? null) : null,
    parentId: draft.recordType === "task" ? (draft.parent?.id ?? null) : null,
    tags: draft.tags,
    links: draft.links.map((link) => ({ entityType: link.entityType, id: link.id })),
  };
}

export function setRecordType(draft: CaptureDraft, recordType: CaptureRecordType): CaptureDraft {
  return touched(draft, {
    recordType,
    questions: withoutQuestion(draft, "recordType"),
    project: recordType === "idea" ? null : draft.project,
    list: recordType === "todo" ? draft.list : null,
    parent: recordType === "task" ? draft.parent : null,
    dueDate: recordType === "idea" ? "" : draft.dueDate,
    priority: recordType === "idea" ? "" : draft.priority,
  });
}

export function setTitle(draft: CaptureDraft, title: string): CaptureDraft {
  return touched(draft, {
    title,
    questions: title.trim() ? withoutQuestion(draft, "title") : draft.questions,
  });
}

export function applyChoice(draft: CaptureDraft, question: CaptureQuestion, choice: CaptureChoice): CaptureDraft {
  if (question.field === "dueDate") {
    return touched(draft, { dueDate: choice.ref, questions: withoutQuestion(draft, "dueDate") });
  }
  if (question.field === "priority" && (CAPTURE_PRIORITIES as readonly string[]).includes(choice.ref)) {
    return touched(draft, {
      priority: choice.ref as CapturePriority,
      questions: withoutQuestion(draft, "priority"),
    });
  }
  if (question.field === "recordType" && (CAPTURE_RECORD_TYPES as readonly string[]).includes(choice.ref)) {
    return setRecordType(draft, choice.ref as CaptureRecordType);
  }
  const ref = choiceRef(choice);
  if (!ref) return draft;
  if (question.field === "project" && ref.entityType === "project") {
    return touched(draft, { project: ref, questions: withoutQuestion(draft, "project") });
  }
  if (question.field === "list" && ref.entityType === "todo_list") {
    return touched(draft, { list: ref, questions: withoutQuestion(draft, "list") });
  }
  if (question.field === "parent" && ref.entityType === "task") {
    return touched(draft, { parent: ref, questions: withoutQuestion(draft, "parent") });
  }
  if (question.field === "links") {
    const links = draft.links.some((link) => link.entityType === ref.entityType && link.id === ref.id)
      ? draft.links
      : [...draft.links, ref];
    return touched(draft, { links, questions: withoutQuestion(draft, "links") });
  }
  return draft;
}

export function leaveQuestion(draft: CaptureDraft, field: string): CaptureDraft {
  if (!OPTIONAL_LEAVE.has(field)) return draft;
  return touched(draft, { questions: withoutQuestion(draft, field) });
}

export function clearRef(draft: CaptureDraft, field: "project" | "list" | "parent"): CaptureDraft {
  return touched(draft, { [field]: null, questions: withoutQuestion(draft, field) });
}

export function removeLink(draft: CaptureDraft, entityType: string, id: number): CaptureDraft {
  return touched(draft, {
    links: draft.links.filter((link) => !(link.entityType === entityType && link.id === id)),
  });
}

export function addTag(draft: CaptureDraft, name: string): CaptureDraft {
  const tag = name.trim();
  if (!tag || draft.tags.includes(tag) || draft.tags.length >= 8) return draft;
  return touched(draft, { tags: [...draft.tags, tag] });
}

export function removeTag(draft: CaptureDraft, name: string): CaptureDraft {
  return touched(draft, { tags: draft.tags.filter((tag) => tag !== name) });
}
