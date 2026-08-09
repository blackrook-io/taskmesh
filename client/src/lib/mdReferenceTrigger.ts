import { isEntityRefPrefix, entityTypeFromPrefix } from "./entityRef";
import type { EntityType } from "./entityType";

export type MdRefTrigger =
  | {
      kind: "entity";
      entityType: EntityType;
      /** Absolute doc positions of the trigger span including `#T`. */
      from: number;
      to: number;
      /** Query after type letter (may be empty). */
      query: string;
      /** Full token after `#` e.g. `T003`. */
      token: string;
    }
  | {
      kind: "user";
      from: number;
      to: number;
      query: string;
    };

/**
 * Detect `#` / `@` reference triggers before `pos` in a TipTap/ProseMirror doc.
 * Heading rule: line-start `#` without a known type letter is ignored.
 */
export function findMdReferenceTrigger(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: { textBetween: (from: number, to: number, blockSep?: string, leafSep?: string) => string; resolve: (pos: number) => any },
  pos: number,
): MdRefTrigger | null {
  if (pos < 1) return null;
  const $pos = doc.resolve(pos);
  const start = $pos.start();
  const textBefore = doc.textBetween(start, pos, "\n", "\n");
  if (!textBefore) return null;

  const atMatch = textBefore.match(/@([^\s@]*)$/);
  if (atMatch) {
    const query = atMatch[1] ?? "";
    if (query.length < 1) return null;
    const from = pos - atMatch[0].length;
    return { kind: "user", from, to: pos, query };
  }

  const hashMatch = textBefore.match(/#([A-Za-z])(\S*)$/);
  if (!hashMatch) return null;

  const typeLetter = hashMatch[1]!;
  const query = hashMatch[2] ?? "";
  if (!isEntityRefPrefix(typeLetter)) return null;

  const hashIndexInBlock = textBefore.length - hashMatch[0].length;
  const atLineStart = hashIndexInBlock === 0 || textBefore[hashIndexInBlock - 1] === "\n";
  // Line-start `#` without type letter already rejected; with type letter allow.
  // Mid-line always allow when type letter present.
  void atLineStart;

  if (query.length < 1) return null;

  const entityType = entityTypeFromPrefix(typeLetter);
  if (!entityType) return null;

  const from = pos - hashMatch[0].length;
  return {
    kind: "entity",
    entityType,
    from,
    to: pos,
    query,
    token: `${typeLetter}${query}`,
  };
}
