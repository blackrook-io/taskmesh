import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "../../../db/client.js";
import * as schema from "../../../db/schema.js";
import { acceptLinkSuggestion, LinkSuggestionError, listLinkSuggestions } from "./service.js";

describe("acceptLinkSuggestion", { concurrency: false }, () => {
  const actor = { userId: 1, isAdministrator: true };
  let srcId = 0;
  let dstId = 0;
  let suggestionId = 0;

  before(async () => {
    const [maxTask] = await db
      .select({ n: schema.tasks.number })
      .from(schema.tasks)
      .orderBy(desc(schema.tasks.number))
      .limit(1);
    const next = Number(maxTask?.n ?? 0);
    const [src] = await db
      .insert(schema.tasks)
      .values({
        number: next + 1,
        title: "t0168 suggestion source",
        createdById: actor.userId,
        updatedById: actor.userId,
        ownerId: actor.userId,
      })
      .returning({ id: schema.tasks.id });
    const [dst] = await db
      .insert(schema.tasks)
      .values({
        number: next + 2,
        title: "t0168 suggestion target",
        createdById: actor.userId,
        updatedById: actor.userId,
        ownerId: actor.userId,
      })
      .returning({ id: schema.tasks.id });
    srcId = src!.id;
    dstId = dst!.id;
    const [suggestion] = await db
      .insert(schema.aiLinkSuggestions)
      .values({
        userId: actor.userId,
        srcType: "task",
        srcId,
        dstType: "task",
        dstId,
        score: 0.7,
        reason: "shared tags",
        signal: "shared_tags",
      })
      .returning({ id: schema.aiLinkSuggestions.id });
    suggestionId = suggestion!.id;
  });

  after(async () => {
    await db.delete(schema.entityLinks).where(
      or(
        and(eq(schema.entityLinks.srcId, srcId), eq(schema.entityLinks.srcType, "task")),
        and(eq(schema.entityLinks.dstId, dstId), eq(schema.entityLinks.dstType, "task")),
      ),
    );
    await db.delete(schema.aiLinkSuggestions).where(
      or(
        and(eq(schema.aiLinkSuggestions.srcType, "task"), inArray(schema.aiLinkSuggestions.srcId, [srcId, dstId])),
        and(eq(schema.aiLinkSuggestions.dstType, "task"), inArray(schema.aiLinkSuggestions.dstId, [srcId, dstId])),
      ),
    );
    await db.delete(schema.tasks).where(inArray(schema.tasks.id, [srcId, dstId]));
  });

  it("creates one manual references link and does not create a second", async () => {
    const listed = await listLinkSuggestions(db, actor, "task", srcId);
    assert.ok(Array.isArray(listed));
    await acceptLinkSuggestion(db, actor, suggestionId);
    const rows = await db
      .select()
      .from(schema.entityLinks)
      .where(
        and(
          eq(schema.entityLinks.srcType, "task"),
          eq(schema.entityLinks.srcId, srcId),
          eq(schema.entityLinks.dstType, "task"),
          eq(schema.entityLinks.dstId, dstId),
          eq(schema.entityLinks.relation, "references"),
          eq(schema.entityLinks.origin, "manual"),
        ),
      );
    assert.equal(rows.length, 1);
    await assert.rejects(
      () => acceptLinkSuggestion(db, actor, suggestionId),
      (err: unknown) => err instanceof LinkSuggestionError && err.code === "not_pending",
    );
    const again = await db
      .select({ id: schema.entityLinks.id })
      .from(schema.entityLinks)
      .where(
        and(
          eq(schema.entityLinks.srcId, srcId),
          eq(schema.entityLinks.dstId, dstId),
          eq(schema.entityLinks.relation, "references"),
          eq(schema.entityLinks.origin, "manual"),
        ),
      );
    assert.equal(again.length, 1);
  });
});
