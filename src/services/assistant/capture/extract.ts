import { z } from "zod";
import { TASK_PRIORITIES, type TaskPriority } from "../../../lib/taskFields.js";
import { CAPTURE_RECORD_TYPES, type CaptureExtraction } from "./types.js";

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

const extractionSchema = z.object({
  recordType: z.enum(CAPTURE_RECORD_TYPES).nullable().optional(),
  typeUnsure: z.boolean().optional(),
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  priorityUnsure: z.boolean().optional(),
  datePhrase: z.string().nullable().optional(),
  dateUnsure: z.boolean().optional(),
  project: z.string().nullable().optional(),
  list: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  parent: z.string().nullable().optional(),
  links: z.array(z.string()).optional(),
});

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export class CaptureParseError extends Error {
  readonly code = "invalid_capture";

  constructor() {
    super("The capture reply was not the expected JSON.");
    this.name = "CaptureParseError";
  }
}

/** Strip a fence and parse the model JSON. Extra keys are ignored. Invalid JSON is an error. */
export function parseCaptureExtraction(raw: string): CaptureExtraction {
  const fenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced);
  } catch {
    throw new CaptureParseError();
  }
  const result = extractionSchema.safeParse(parsed);
  if (!result.success) throw new CaptureParseError();
  const row = result.data;
  const priorityWord = row.priority?.trim().toLowerCase() ?? "";
  const mapped = priorityWord ? PRIORITY_WORDS[priorityWord] ?? null : null;
  const priorityUnsure = row.priorityUnsure === true || (priorityWord.length > 0 && mapped == null);
  return {
    recordType: row.recordType ?? null,
    typeUnsure: row.typeUnsure === true,
    title: row.title?.trim() ?? "",
    description: blankToNull(row.description),
    priority: mapped,
    priorityUnsure,
    datePhrase: blankToNull(row.datePhrase),
    dateUnsure: row.dateUnsure === true,
    project: blankToNull(row.project),
    list: blankToNull(row.list),
    tags: (row.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    parent: blankToNull(row.parent),
    links: (row.links ?? []).map((link) => link.trim()).filter((link) => link.length > 0),
  };
}
