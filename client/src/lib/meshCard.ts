import { containmentParent, type MeshGraphEdge, type MeshSuggestion } from "./meshLayout";
import { isStale, schedule, type MeshSignalNode } from "./meshSignals";

const LINK_RELATIONS = new Set(["relates_to", "references", "supports", "part_of"]);
const MS_DAY = 864e5;

const TYPE_LABELS: Record<string, string> = {
  project: "Project",
  todo_list: "ToDo List",
  task: "Task",
  todo: "ToDo",
  document: "Document",
  idea: "Idea",
  board: "Board",
  canvas: "Canvas",
  wiki_node: "Wiki",
  image_board: "Image board",
  tag: "Tag",
};

const STATE_LABELS: Record<string, string> = {
  new: "Draft",
  blocked: "Blocked",
  ready: "Ready",
  in_progress: "In Progress",
  pending: "Pending",
  complete: "Complete",
  canceled: "Canceled",
  on_hold: "On Hold",
  deleted: "Deleted",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const FIELD_LABELS: Record<string, string> = {
  state: "State",
  progress: "Progress",
  status: "Status",
  body: "Content edited",
};

export type MeshCardTone = "danger" | "warning" | null;

export type MeshCardRow = {
  label: string;
  value: string;
  tone: MeshCardTone;
  /** Excerpt shown under this row when the comment was posted with the update. */
  quote: string | null;
};

export type MeshCardUpdate = {
  at: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

export type MeshCardComment = {
  at: string;
  excerpt: string;
  withUpdate: boolean;
};

export type MeshCardNode = MeshSignalNode & {
  type?: string;
  referenceId?: string | null;
  title: string;
  projectLabel?: string | null;
  lastUpdate?: MeshCardUpdate | null;
  lastComment?: MeshCardComment | null;
};

export type MeshCardModel = {
  referenceId: string | null;
  type: string;
  typeLabel: string;
  title: string;
  state: string | null;
  stateLabel: string | null;
  priority: string | null;
  priorityLabel: string | null;
  progress: number | null;
  rows: MeshCardRow[];
  hint: string;
  description: string;
};

export type MeshSuggestionCardItem = {
  targetKey: string;
  targetLabel: string;
  confidence: number;
  reason: string;
};

export type MeshSuggestionCardModel = {
  referenceId: string | null;
  type: string;
  typeLabel: string;
  title: string;
  projectNote: string;
  items: MeshSuggestionCardItem[];
  hint: string;
  description: string;
};

function ageLabel(at: string, today: Date): string {
  const days = Math.round((today.getTime() - new Date(at).getTime()) / MS_DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function dueLabel(dueDate: string): string {
  return new Date(`${dueDate}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function updatePhrase(update: MeshCardUpdate): string {
  if (update.field === "body" || (update.oldValue == null && update.newValue == null)) {
    return FIELD_LABELS[update.field] ?? "Updated";
  }
  const label = FIELD_LABELS[update.field] ?? update.field;
  return `${label} ${update.oldValue} → ${update.newValue}`;
}

function directChildren(
  key: string,
  nodes: readonly MeshCardNode[],
  edges: readonly MeshGraphEdge[],
): MeshCardNode[] {
  return nodes.filter((node) => node.key !== key && containmentParent(node.key, edges) === key);
}

function descendantsOf(
  key: string,
  nodes: readonly MeshCardNode[],
  edges: readonly MeshGraphEdge[],
): MeshCardNode[] {
  const out: MeshCardNode[] = [];
  const queue = directChildren(key, nodes, edges);
  const seen = new Set<string>();
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || seen.has(next.key)) continue;
    seen.add(next.key);
    out.push(next);
    queue.push(...directChildren(next.key, nodes, edges));
  }
  return out;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function buildMeshCard(input: {
  node: MeshCardNode;
  nodes: readonly MeshCardNode[];
  edges: readonly MeshGraphEdge[];
  today: Date;
  staleDays: number;
  isFocus: boolean;
  suggestions?: readonly Pick<MeshSuggestion, "sourceKey" | "targetKey">[];
}): MeshCardModel {
  const { node, nodes, edges, today, staleDays, isFocus } = input;
  const byKey = new Map(nodes.map((item) => [item.key, item]));
  const rows: MeshCardRow[] = [];
  const type = node.type ?? "task";

  if (node.projectLabel) {
    rows.push({ label: "Project", value: node.projectLabel, tone: null, quote: null });
  }
  if (node.progress != null) {
    rows.push({
      label: "Progress",
      value: `${node.progress}% complete`,
      tone: null,
      quote: null,
    });
  }
  if (node.dueDate) {
    const detail = schedule(node, today);
    const date = dueLabel(node.dueDate);
    if (detail.kind === "overdue" && detail.days != null) {
      rows.push({
        label: "Due",
        value: `${date} · ${detail.days} days overdue`,
        tone: "danger",
        quote: null,
      });
    } else if (detail.kind === "risk" && detail.used != null) {
      rows.push({
        label: "Due",
        value: `${date} · at risk, ${detail.used}% of time used`,
        tone: "warning",
        quote: null,
      });
    } else if (detail.kind === "ok" && detail.days != null) {
      rows.push({
        label: "Due",
        value: `${date} · ${detail.days} days left`,
        tone: null,
        quote: null,
      });
    } else {
      rows.push({ label: "Due", value: date, tone: null, quote: null });
    }
  }

  const comment = node.lastComment ?? null;
  const paired = comment?.withUpdate === true && node.lastUpdate != null;
  if (node.lastUpdate) {
    const stale = isStale(node, today, staleDays);
    const phrase = `${ageLabel(node.lastUpdate.at, today)} · ${updatePhrase(node.lastUpdate)}`;
    rows.push({
      label: "Last update",
      value: stale ? `${phrase} · stale` : phrase,
      tone: stale ? "warning" : null,
      quote: paired && comment ? comment.excerpt : null,
    });
  }
  if (comment && !paired) {
    rows.push({
      label: "Last comment",
      value: `${ageLabel(comment.at, today)} · ${comment.excerpt}`,
      tone: null,
      quote: null,
    });
  }

  const children = directChildren(node.key, nodes, edges);
  if (children.length > 0) {
    const done = children.filter((child) => child.state === "complete").length;
    const below = descendantsOf(node.key, nodes, edges);
    const overdue = below.filter((item) => schedule(item, today).kind === "overdue").length;
    const risk = below.filter((item) => schedule(item, today).kind === "risk").length;
    const stale = below.filter((item) => isStale(item, today, staleDays)).length;
    const bits = [`${done} of ${children.length} done`];
    if (overdue > 0) bits.push(plural(overdue, "overdue", "overdue"));
    if (risk > 0) bits.push(plural(risk, "at risk", "at risk"));
    if (stale > 0) bits.push(plural(stale, "stale", "stale"));
    rows.push({
      label: "Inside",
      value: bits.join(" · "),
      tone: overdue > 0 ? "danger" : risk > 0 ? "warning" : null,
      quote: null,
    });
  }

  const blocked = edges.flatMap((edge) => {
    if (edge.relation !== "depends_on" || edge.source !== node.key) return [];
    const prerequisite = byKey.get(edge.target);
    if (!prerequisite || prerequisite.state === "complete") return [];
    const ref = prerequisite.referenceId ?? prerequisite.key;
    return [`${ref} ${prerequisite.title}`];
  });
  if (blocked.length > 0) {
    rows.push({ label: "Blocked by", value: blocked.join(", "), tone: "danger", quote: null });
  }

  let references = 0;
  let dependencies = 0;
  for (const edge of edges) {
    if (edge.source !== node.key && edge.target !== node.key) continue;
    if (LINK_RELATIONS.has(edge.relation)) references += 1;
    else if (edge.relation === "depends_on") dependencies += 1;
  }
  const links: string[] = [];
  if (references > 0) links.push(plural(references, "reference", "references"));
  if (dependencies > 0) links.push(plural(dependencies, "dependency", "dependencies"));
  const suggested = (input.suggestions ?? []).filter(
    (item) => item.sourceKey === node.key || item.targetKey === node.key,
  ).length;
  if (suggested > 0) links.push(plural(suggested, "suggested", "suggested"));
  if (links.length > 0) {
    rows.push({ label: "Links", value: links.join(" · "), tone: null, quote: null });
  }

  const hint = isFocus
    ? "This is the focused record."
    : children.length > 0
      ? "Click to cascade its contents underneath."
      : "Click to focus and see its links.";

  const stateLabel = node.state ? (STATE_LABELS[node.state] ?? node.state) : null;
  const priorityLabel =
    node.priority && node.priority !== "none" ? (PRIORITY_LABELS[node.priority] ?? node.priority) : null;
  const model: MeshCardModel = {
    referenceId: node.referenceId ?? null,
    type,
    typeLabel: TYPE_LABELS[type] ?? type,
    title: node.title,
    state: node.state ?? null,
    stateLabel,
    priority: priorityLabel ? (node.priority ?? null) : null,
    priorityLabel,
    progress: node.progress ?? null,
    rows,
    hint,
    description: "",
  };
  model.description = cardDescription(model);
  return model;
}

function cardDescription(card: MeshCardModel): string {
  const parts = [
    [card.referenceId, card.typeLabel].filter(Boolean).join(" "),
    card.title,
    card.stateLabel,
    card.priorityLabel ? `${card.priorityLabel} priority` : null,
    card.progress != null ? `${card.progress}% complete` : null,
    ...card.rows.flatMap((row) => [row.label, row.value, row.quote]),
    card.hint,
  ];
  return parts.filter((part) => part != null && part !== "").join(". ");
}

export function buildMeshSuggestionCard(input: {
  node: MeshCardNode;
  nodes: readonly MeshCardNode[];
  suggestions: readonly MeshSuggestion[];
}): MeshSuggestionCardModel | null {
  const { node, nodes } = input;
  const byKey = new Map(nodes.map((item) => [item.key, item]));
  const items: MeshSuggestionCardItem[] = [];
  for (const suggestion of input.suggestions) {
    if (suggestion.sourceKey !== node.key) continue;
    const target = byKey.get(suggestion.targetKey);
    if (!target) continue;
    const ref = target.referenceId ?? target.key;
    items.push({
      targetKey: suggestion.targetKey,
      targetLabel: `${ref} ${target.title}`,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
    });
  }
  if (items.length === 0) return null;
  const type = node.type ?? "task";
  const typeLabel = TYPE_LABELS[type] ?? type;
  const model: MeshSuggestionCardModel = {
    referenceId: node.referenceId ?? null,
    type,
    typeLabel,
    title: node.title,
    projectNote: node.projectLabel ? `From ${node.projectLabel}` : "Already in this project",
    items,
    hint: "Suggestions stay dotted until you accept them. Accepted links become ordinary references.",
    description: "",
  };
  const parts = [
    [model.referenceId, model.typeLabel].filter(Boolean).join(" "),
    "AI suggestion",
    model.title,
    model.projectNote,
    ...items.flatMap((item) => [
      `Link to ${item.targetLabel}`,
      `${item.confidence}% match`,
      item.reason,
    ]),
    "Accept link",
    "Dismiss",
    model.hint,
  ];
  model.description = parts.filter((part) => part !== "").join(". ");
  return model;
}
