/** Directed link labels stored on `entity_links.relation`. */
export const LINK_RELATIONS = ["relates_to", "references", "supports", "part_of"] as const;
export type LinkRelation = (typeof LINK_RELATIONS)[number];

/** `manual` is user-authored. `mention` is reserved for markdown sync (T0161). */
export const LINK_ORIGINS = ["manual", "mention"] as const;
export type LinkOrigin = (typeof LINK_ORIGINS)[number];

export type EntityEndRef = {
  entityType: string;
  id: number;
};

export function isLinkRelation(value: string): value is LinkRelation {
  return (LINK_RELATIONS as readonly string[]).includes(value);
}

export function isLinkOrigin(value: string): value is LinkOrigin {
  return (LINK_ORIGINS as readonly string[]).includes(value);
}

export function isSelfLink(
  srcType: string,
  srcId: number,
  dstType: string,
  dstId: number,
): boolean {
  return srcType === dstType && srcId === dstId;
}

/** Unique-key identity. Origin is part of the key so a mention and a manual link can coexist. */
export function linkIdentityKey(parts: {
  srcType: string;
  srcId: number;
  dstType: string;
  dstId: number;
  relation: string;
  origin: string;
}): string {
  return [
    parts.srcType,
    parts.srcId,
    parts.dstType,
    parts.dstId,
    parts.relation,
    parts.origin,
  ].join("|");
}

export function entityEndKey(entityType: string, id: number): string {
  return `${entityType}:${id}`;
}

/**
 * Drop a link unless both ends are in `visibleKeys`.
 * Soft-deleted tasks and todos are represented by absence from the set.
 */
export function filterLinksVisibleAtBothEnds<T extends { src: EntityEndRef; dst: EntityEndRef }>(
  links: T[],
  visibleKeys: ReadonlySet<string>,
): T[] {
  return links.filter(
    (link) =>
      visibleKeys.has(entityEndKey(link.src.entityType, link.src.id)) &&
      visibleKeys.has(entityEndKey(link.dst.entityType, link.dst.id)),
  );
}
