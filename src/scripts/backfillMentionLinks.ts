/**
 * Scan saved Markdown and sync mention links.
 * Dry run: `npx tsx src/scripts/backfillMentionLinks.ts --dry-run`
 */
import "dotenv/config";
import { eq, ne } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import * as schema from "../db/schema.js";
import type { EntityType } from "../lib/entityType.js";
import { syncMentionLinks, type MentionSyncResult } from "../services/mentionLinks.js";

const dryRun = process.argv.includes("--dry-run");

type Source = {
  srcType: EntityType;
  srcId: number;
  markdown: string | null;
  actorUserId: number;
};

async function scan(): Promise<Source[]> {
  const sources: Source[] = [];

  const tasks = await db
    .select({
      id: schema.tasks.id,
      description: schema.tasks.description,
      ownerId: schema.tasks.ownerId,
    })
    .from(schema.tasks)
    .where(ne(schema.tasks.state, "deleted"));
  for (const row of tasks) {
    sources.push({
      srcType: "task",
      srcId: row.id,
      markdown: row.description,
      actorUserId: row.ownerId,
    });
  }

  const todos = await db
    .select({
      id: schema.todos.id,
      description: schema.todos.description,
      ownerId: schema.todos.ownerId,
    })
    .from(schema.todos)
    .where(ne(schema.todos.state, "deleted"));
  for (const row of todos) {
    sources.push({
      srcType: "todo",
      srcId: row.id,
      markdown: row.description,
      actorUserId: row.ownerId,
    });
  }

  const ideas = await db
    .select({ id: schema.ideas.id, body: schema.ideas.body, ownerId: schema.ideas.ownerId })
    .from(schema.ideas);
  for (const row of ideas) {
    sources.push({
      srcType: "idea",
      srcId: row.id,
      markdown: row.body,
      actorUserId: row.ownerId,
    });
  }

  const documents = await db
    .select({
      id: schema.projectDocuments.id,
      body: schema.projectDocuments.body,
      kind: schema.projectDocuments.kind,
      ownerId: schema.projects.ownerId,
    })
    .from(schema.projectDocuments)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectDocuments.projectId));
  for (const row of documents) {
    if (row.kind !== "markdown") continue;
    sources.push({
      srcType: "document",
      srcId: row.id,
      markdown: row.body,
      actorUserId: row.ownerId,
    });
  }

  return sources;
}

const totals: MentionSyncResult = { added: 0, removed: 0 };
const byType = new Map<string, MentionSyncResult>();

for (const source of await scan()) {
  const result = await syncMentionLinks(db, { ...source, dryRun });
  totals.added += result.added;
  totals.removed += result.removed;
  const bucket = byType.get(source.srcType) ?? { added: 0, removed: 0 };
  bucket.added += result.added;
  bucket.removed += result.removed;
  byType.set(source.srcType, bucket);
}

for (const [type, result] of byType) {
  console.log(`${type}: add ${result.added}, remove ${result.removed}`);
}
console.log(
  dryRun
    ? `dry-run: would add ${totals.added}, remove ${totals.removed}; wrote nothing`
    : `wrote add ${totals.added}, remove ${totals.removed}`,
);

await pool.end();
