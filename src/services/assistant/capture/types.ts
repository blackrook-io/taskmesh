import type { EntityType } from "../../../lib/entityType.js";
import type { TaskPriority } from "../../../lib/taskFields.js";

export const CAPTURE_RECORD_TYPES = ["task", "todo", "idea"] as const;
export type CaptureRecordType = (typeof CAPTURE_RECORD_TYPES)[number];

export const CAPTURE_LOOKUP_TYPES = [
  "task",
  "todo",
  "idea",
  "project",
  "document",
  "todo_list",
] as const;
export type CaptureLookupType = (typeof CAPTURE_LOOKUP_TYPES)[number];

export type CaptureExtraction = {
  recordType: CaptureRecordType | null;
  typeUnsure: boolean;
  title: string;
  description: string | null;
  priority: TaskPriority | null;
  priorityUnsure: boolean;
  datePhrase: string | null;
  dateUnsure: boolean;
  project: string | null;
  list: string | null;
  tags: string[];
  parent: string | null;
  links: string[];
};

export type CaptureHit = {
  entityType: CaptureLookupType;
  id: number;
  number: number;
  title: string;
  projectId: number | null;
};

export type CaptureLookup = (phrase: string) => CaptureHit[];

export type CaptureChoice = {
  ref: string;
  title: string;
  /** Set when the choice is an existing record. Date choices omit both. */
  entityType?: CaptureLookupType;
  id?: number;
};

export type CaptureQuestion = {
  field: string;
  prompt: string;
  choices?: CaptureChoice[];
};

export type CaptureRef = {
  entityType: EntityType;
  id: number;
  ref: string;
  title: string;
  projectId: number | null;
};

export type CaptureProposal = {
  recordType: CaptureRecordType | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: TaskPriority | null;
  project: CaptureRef | null;
  list: CaptureRef | null;
  tags: string[];
  parent: CaptureRef | null;
  links: CaptureRef[];
};

export type ResolvedCapture = {
  proposal: CaptureProposal;
  questions: CaptureQuestion[];
  confirmable: boolean;
};
