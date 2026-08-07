/** Canonical polymorphic entity types for tags, boards, wiki, etc. */
export const ENTITY_TYPES = [
  "idea",
  "project",
  "task",
  "document",
  "todo_list",
  "board",
  "canvas",
  "wiki_node",
  "image_board",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}
