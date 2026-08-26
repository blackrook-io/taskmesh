import type { EntityType } from "./entityType";

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

export function isEntityRefPrefix(letter: string): boolean {
  return entityTypeFromPrefix(letter) != null;
}
