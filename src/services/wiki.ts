import { and, asc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

type Db = NodePgDatabase<typeof schema>;

export type WikiNodeRow = typeof schema.wikiNodes.$inferSelect;

export type WikiTreeNode = WikiNodeRow & { children: WikiTreeNode[] };

export function buildWikiTree(rows: WikiNodeRow[]): WikiTreeNode[] {
  const byParent = new Map<number | null, WikiNodeRow[]>();
  for (const row of rows) {
    const key = row.parentId;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }
  const walk = (parentId: number | null): WikiTreeNode[] => {
    const kids = byParent.get(parentId) ?? [];
    return kids.map((row) => ({ ...row, children: walk(row.id) }));
  };
  return walk(null);
}

export async function listWikiNodes(db: Db, projectId: number) {
  return db
    .select()
    .from(schema.wikiNodes)
    .where(eq(schema.wikiNodes.projectId, projectId))
    .orderBy(asc(schema.wikiNodes.sortOrder), asc(schema.wikiNodes.id));
}

export async function nextWikiSort(
  db: Db,
  projectId: number,
  parentId: number | null,
): Promise<number> {
  const rows =
    parentId == null
      ? await db
          .select({ m: schema.wikiNodes.sortOrder })
          .from(schema.wikiNodes)
          .where(and(eq(schema.wikiNodes.projectId, projectId), isNull(schema.wikiNodes.parentId)))
      : await db
          .select({ m: schema.wikiNodes.sortOrder })
          .from(schema.wikiNodes)
          .where(
            and(eq(schema.wikiNodes.projectId, projectId), eq(schema.wikiNodes.parentId, parentId)),
          );
  return rows.length ? Math.max(...rows.map((r) => r.m)) + 1 : 0;
}

/** True if `maybeAncestorId` is nodeId or an ancestor of nodeId. */
export function wouldCreateCycle(
  rows: WikiNodeRow[],
  nodeId: number,
  newParentId: number | null,
): boolean {
  if (newParentId == null) return false;
  if (newParentId === nodeId) return true;
  const byId = new Map(rows.map((r) => [r.id, r]));
  let cur: number | null = newParentId;
  const guard = new Set<number>();
  while (cur != null) {
    if (cur === nodeId) return true;
    if (guard.has(cur)) break;
    guard.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export function breadcrumbFor(rows: WikiNodeRow[], nodeId: number): WikiNodeRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chain: WikiNodeRow[] = [];
  let cur: number | null = nodeId;
  const guard = new Set<number>();
  while (cur != null && !guard.has(cur)) {
    guard.add(cur);
    const row = byId.get(cur);
    if (!row) break;
    chain.unshift(row);
    cur = row.parentId;
  }
  return chain;
}
