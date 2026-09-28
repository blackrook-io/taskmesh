import type { Idea, Tag } from "../types";

export type IdeaListRow = Idea & { tags: Tag[] };

function tagSortKey(tags: Tag[]): string {
  return tags
    .map((t) => t.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .join(", ");
}

function dateKey(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Column compare for idea rows. `0` means tie (caller keeps manual order). */
export function compareIdeas(a: IdeaListRow, b: IdeaListRow, col: string): number {
  switch (col) {
    case "title":
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    case "tags":
      return tagSortKey(a.tags).localeCompare(tagSortKey(b.tags), undefined, { sensitivity: "base" });
    case "createdAt":
      return dateKey(a.createdAt) - dateKey(b.createdAt);
    case "updatedAt":
      return dateKey(a.updatedAt) - dateKey(b.updatedAt);
    case "number":
      return a.number - b.number;
    default:
      return 0;
  }
}

export function sortIdeas(ideas: IdeaListRow[], col: string | null, dir: 1 | -1): IdeaListRow[] {
  if (col == null) return ideas;
  return [...ideas].sort((a, b) => {
    const primary = compareIdeas(a, b, col);
    if (primary !== 0) return primary * dir;
    return a.sortOrder - b.sortOrder || a.id - b.id;
  });
}
