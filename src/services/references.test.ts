import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { searchEntityReferences, searchUserReferences } from "./references.js";

/**
 * T0143: `references/search` used to run with no ownership predicate at all,
 * letting any authenticated user enumerate every task, idea, project, document,
 * board, canvas, wiki node and todo list in the instance.
 *
 * These tests pin the two properties that closed it:
 *   1. an empty query never enumerates rows, and
 *   2. every entity branch consults the ownership tables before querying.
 *
 * The fake db records which tables were touched; it never reaches Postgres.
 */
function recordingDb() {
  const tables: unknown[] = [];
  const whereClauses: unknown[] = [];
  const chain = {
    from(table: unknown) {
      tables.push(table);
      return chain;
    },
    where(clause: unknown) {
      whereClauses.push(clause);
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit() {
      return [];
    },
    then(resolve: (rows: never[]) => unknown) {
      return resolve([]);
    },
  };
  const db = {
    select() {
      return chain;
    },
  } as never;
  return { db, tables, whereClauses };
}

const ACTOR = { userId: 7, isAdministrator: false };
const ADMIN = { userId: 1, isAdministrator: true };

describe("searchUserReferences (T0143)", () => {
  it("returns nothing for an empty query instead of listing users", async () => {
    const { db, tables } = recordingDb();
    const hits = await searchUserReferences(db, "");
    assert.deepEqual(hits, []);
    assert.equal(tables.length, 0, "must not query the users table at all");
  });

  it("returns nothing for a whitespace-only query", async () => {
    const { db, tables } = recordingDb();
    assert.deepEqual(await searchUserReferences(db, "   "), []);
    assert.equal(tables.length, 0);
  });
});

describe("searchEntityReferences ownership scoping (T0143)", () => {
  /** Types scoped through project/owner subqueries rather than a plain column eq. */
  const subqueryScopedTypes = [
    "task",
    "todo",
    "project",
    "document",
    "board",
    "canvas",
    "wiki_node",
    "todo_list",
    "image_board",
  ] as const;

  for (const entityType of subqueryScopedTypes) {
    it(`builds an ownership subquery for ${entityType} as a non-administrator`, async () => {
      const { db, tables } = recordingDb();
      await searchEntityReferences(db, entityType, "alpha", ACTOR);
      assert.ok(
        tables.length > 1,
        `${entityType} query ran without building any ownership subquery`,
      );
    });
  }

  it("filters ideas by owner_id (plain column scope, no subquery)", async () => {
    const actor = recordingDb();
    await searchEntityReferences(actor.db, "idea", "alpha", ACTOR);
    const rendered = new PgDialect().sqlToQuery(actor.whereClauses[0] as SQL).sql;
    assert.match(
      rendered,
      /owner_id/,
      "idea search must constrain owner_id for non-administrators",
    );

    const admin = recordingDb();
    await searchEntityReferences(admin.db, "idea", "alpha", ADMIN);
    const adminRendered = new PgDialect().sqlToQuery(admin.whereClauses[0] as SQL).sql;
    assert.doesNotMatch(
      adminRendered,
      /owner_id/,
      "administrators should not be owner-filtered",
    );
  });

  it("skips ownership subqueries for administrators", async () => {
    const { db, tables } = recordingDb();
    await searchEntityReferences(db, "idea", "alpha", ADMIN);
    assert.equal(
      tables.length,
      1,
      "administrators need no ownership filter, so only the entity table is read",
    );
  });

  it("requires an actor argument (compile-time guard)", () => {
    // `actor` is a required positional parameter — a caller that forgets it
    // fails to typecheck rather than silently running unscoped.
    assert.equal(searchEntityReferences.length >= 4, true);
  });
});
