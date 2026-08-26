import type { EntityType } from "./entityType.js";

/** Single-letter prefixes for Markdown `#` references. */
export const ENTITY_REF_PREFIXES = {
  idea: "I",
  project: "P",
  task: "T",
  /** ToDo items (UI: ToDo). Documents previously used D; now N. */
  todo: "D",
  document: "N",
  todo_list: "L",
  board: "B",
  canvas: "C",
  wiki_node: "W",
  image_board: "M",
} as const satisfies Record<EntityType, string>;

export type EntityRefPrefix = (typeof ENTITY_REF_PREFIXES)[EntityType];

const PREFIX_TO_TYPE = Object.fromEntries(
  (Object.entries(ENTITY_REF_PREFIXES) as [EntityType, string][]).map(([t, p]) => [
    p.toUpperCase(),
    t,
  ]),
) as Record<string, EntityType>;

export function formatEntityRef(entityType: EntityType, n: number): string {
  const prefix = ENTITY_REF_PREFIXES[entityType];
  return `${prefix}${String(n).padStart(4, "0")}`;
}

export function entityTypeFromPrefix(letter: string): EntityType | null {
  if (!letter) return null;
  return PREFIX_TO_TYPE[letter.toUpperCase()] ?? null;
}

/** Parse `T0031`, `t31`, `0031` (with optional known type) → { entityType?, number }. */
export function parseEntityRefToken(
  raw: string,
  defaultType?: EntityType,
): { entityType: EntityType | null; number: number | null; query: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { entityType: defaultType ?? null, number: null, query: "" };

  const withPrefix = trimmed.match(/^([A-Za-z])(\d*)$/);
  if (withPrefix) {
    const entityType = entityTypeFromPrefix(withPrefix[1]!);
    const digits = withPrefix[2] ?? "";
    const number = digits.length ? Number(digits.replace(/^0+(?=\d)/, "") || digits) : null;
    return {
      entityType: entityType ?? defaultType ?? null,
      number: number != null && Number.isFinite(number) ? number : null,
      query: trimmed,
    };
  }

  const digitsOnly = trimmed.match(/^0*(\d+)$/);
  if (digitsOnly) {
    const number = Number(digitsOnly[1]);
    return {
      entityType: defaultType ?? null,
      number: Number.isFinite(number) ? number : null,
      query: trimmed,
    };
  }

  return { entityType: defaultType ?? null, number: null, query: trimmed };
}
