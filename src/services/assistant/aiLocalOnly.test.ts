import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { listAiCapabilities } from "./aiCapabilities.js";
import { resolveFeatureRoute } from "./aiRouting.js";
import { loadAiProviderPlugins } from "./providerLoader.js";
import { resolveEffectiveLocalOnly } from "./projectAiAccess.js";
import { executeAssistantTool } from "./tools.js";
import {
  invalidateSystemPropertiesCache,
  patchSystemProperties,
} from "../systemProperties.js";

const ACTOR = 1;
const SECRET = `local-only-secret-${Date.now()}`;
const EMPTY_ENV = {} as NodeJS.ProcessEnv;

describe("project local-only", { concurrency: false }, () => {
  let projectId = 0;
  let taskId = 0;
  let originalLocalOnly: unknown;

  before(async () => {
    await loadAiProviderPlugins();
    const [ceiling] = await db
      .select({ value: schema.systemProperties.value })
      .from(schema.systemProperties)
      .where(eq(schema.systemProperties.key, "ai_project_local_only"))
      .limit(1);
    originalLocalOnly = ceiling?.value ?? null;
    const [maxProject] = await db
      .select({ n: schema.projects.number })
      .from(schema.projects)
      .orderBy(desc(schema.projects.number))
      .limit(1);
    const [project] = await db
      .insert(schema.projects)
      .values({
        number: Number(maxProject?.n ?? 0) + 1,
        name: SECRET,
        ownerId: ACTOR,
        aiAccess: "full",
        aiLocalOnly: true,
      })
      .returning({ id: schema.projects.id });
    projectId = project!.id;
    const [maxTask] = await db
      .select({ n: schema.tasks.number })
      .from(schema.tasks)
      .orderBy(desc(schema.tasks.number))
      .limit(1);
    const [task] = await db
      .insert(schema.tasks)
      .values({
        number: Number(maxTask?.n ?? 0) + 1,
        title: SECRET,
        projectId,
        createdById: ACTOR,
        updatedById: ACTOR,
        ownerId: ACTOR,
      })
      .returning({ id: schema.tasks.id });
    taskId = task!.id;
  });

  after(async () => {
    await db.delete(schema.tasks).where(eq(schema.tasks.id, taskId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    if (originalLocalOnly == null) {
      await db
        .delete(schema.systemProperties)
        .where(eq(schema.systemProperties.key, "ai_project_local_only"));
    } else {
      await patchSystemProperties(db, { aiProjectLocalOnly: originalLocalOnly === true });
    }
    invalidateSystemPropertiesCache();
  });

  it("does not return record text from a local-only project on a cloud turn", async () => {
    const denied = await executeAssistantTool(
      "get_entity",
      JSON.stringify({ entityType: "task", entityId: taskId }),
      { actorUserId: ACTOR, isAdministrator: true, routeLocalOnly: false },
    );
    assert.equal(denied.includes(SECRET), false);
    assert.match(denied, /local models/i);

    const search = await executeAssistantTool(
      "search_records",
      JSON.stringify({ q: SECRET.slice(0, 40) }),
      { actorUserId: ACTOR, isAdministrator: true, routeLocalOnly: false },
    );
    assert.equal(search.includes(SECRET), false);
  });

  it("returns the record when the turn is local-only", async () => {
    const allowed = await executeAssistantTool(
      "get_entity",
      JSON.stringify({ entityType: "task", entityId: taskId }),
      { actorUserId: ACTOR, isAdministrator: true, routeLocalOnly: true },
    );
    assert.equal(allowed.includes(SECRET), true);
  });

  it("treats the ceiling as forcing local-only without rewriting the project", async () => {
    await db.update(schema.projects).set({ aiLocalOnly: false }).where(eq(schema.projects.id, projectId));
    await patchSystemProperties(db, { aiProjectLocalOnly: true });
    assert.equal(await resolveEffectiveLocalOnly(db, projectId), true);
    const denied = await executeAssistantTool(
      "get_entity",
      JSON.stringify({ entityType: "task", entityId: taskId }),
      { actorUserId: ACTOR, isAdministrator: true, routeLocalOnly: false },
    );
    assert.equal(denied.includes(SECRET), false);
    await patchSystemProperties(db, { aiProjectLocalOnly: false });
    assert.equal(await resolveEffectiveLocalOnly(db, projectId), false);
    await db.update(schema.projects).set({ aiLocalOnly: true }).where(eq(schema.projects.id, projectId));
  });

  it("hides the assistant when a local-only project has no local model", async () => {
    const route = await resolveFeatureRoute(db, { userId: ACTOR, localOnly: true, env: EMPTY_ENV });
    const caps = await listAiCapabilities(db, { userId: ACTOR, projectId, env: EMPTY_ENV });
    const assistant = caps.find((row) => row.id === "assistant");
    if (route.attempts.length === 0) {
      assert.equal(assistant?.available, false);
      assert.equal(assistant?.reason, "no_local_model");
      return;
    }
    assert.notEqual(assistant?.reason, "project_excluded");
  });
});
