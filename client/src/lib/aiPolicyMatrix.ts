export type AiTier = 0 | 1 | 2 | 3;

export const AI_POLICY_ACTIONS: Array<{ id: string; label: string; tier: AiTier }> = [
  { id: "read", label: "Read", tier: 0 },
  { id: "web_fetch", label: "Web fetch", tier: 0 },
  { id: "link", label: "Link", tier: 1 },
  { id: "tag", label: "Tag", tier: 1 },
  { id: "comment", label: "Comment", tier: 1 },
  { id: "propose_create", label: "Propose create", tier: 2 },
  { id: "propose_update", label: "Propose update", tier: 2 },
  { id: "apply", label: "Apply", tier: 2 },
  { id: "propose_delete", label: "Propose delete", tier: 3 },
  { id: "bulk", label: "Bulk", tier: 3 },
];

export const AI_POLICY_RECORD_TYPES: Array<{ id: string; label: string }> = [
  { id: "idea", label: "Idea" },
  { id: "project", label: "Project" },
  { id: "task", label: "Task" },
  { id: "document", label: "Document" },
  { id: "todo", label: "Todo" },
  { id: "todo_list", label: "Todo list" },
];

export const AI_POLICY_FLOOR = [
  "Users",
  "Roles",
  "Groups",
  "API keys",
  "AI credentials",
  "Backups",
  "Ownership",
  "System properties",
  "AI policy",
];

export function aiPolicyCellKey(action: string, recordType?: string): string {
  return recordType ? `${action}:${recordType}` : action;
}
