import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activityForGraphNode,
  commentExcerpt,
  commentPairsWithUpdate,
  deriveListLastUpdate,
  documentBodyChanged,
  trackedStatusChange,
  trackedTodoChanges,
  type LastUpdate,
} from "./entityActivity.js";

const update = (at: string, field = "state"): LastUpdate => ({
  at,
  field,
  oldValue: "Draft",
  newValue: "Ready",
});

describe("tracked field changes", () => {
  it("records todo state and progress only when they change", () => {
    assert.deepEqual(
      trackedTodoChanges({ state: "ready", progress: 10 }, { state: "ready", progress: 10 }),
      [],
    );
    assert.deepEqual(
      trackedTodoChanges({ state: "new", progress: 60 }, { state: "in_progress", progress: 70 }),
      [
        { field: "state", oldValue: "Draft", newValue: "In Progress" },
        { field: "progress", oldValue: "60", newValue: "70" },
      ],
    );
    assert.deepEqual(
      trackedTodoChanges(
        { state: "ready", progress: 10, estimateHours: null },
        { state: "ready", progress: 10, estimateHours: 1.25 },
      ),
      [{ field: "estimateHours", oldValue: "none", newValue: "1.25" }],
    );
  });

  it("records a project status label change", () => {
    assert.equal(trackedStatusChange("active", "active"), null);
    assert.deepEqual(trackedStatusChange("idea", "active"), {
      field: "status",
      oldValue: "Idea",
      newValue: "Active",
    });
  });

  it("treats a document body edit as a change without comparing text", () => {
    assert.equal(documentBodyChanged("same", "same"), false);
    assert.equal(documentBodyChanged(null, ""), true);
    assert.equal(documentBodyChanged("before", "after"), true);
  });
});

describe("comment pairing", () => {
  const at = new Date("2026-10-01T12:00:00.000Z");

  it("pairs the same actor inside two minutes", () => {
    assert.equal(
      commentPairsWithUpdate(
        { at: new Date(at.getTime() + 120_000), actorId: 4 },
        { at, actorId: 4 },
      ),
      true,
    );
  });

  it("rejects a different actor, a missing actor, or a wider gap", () => {
    assert.equal(
      commentPairsWithUpdate(
        { at: new Date(at.getTime() + 60_000), actorId: 5 },
        { at, actorId: 4 },
      ),
      false,
    );
    assert.equal(
      commentPairsWithUpdate({ at, actorId: null }, { at, actorId: 4 }),
      false,
    );
    assert.equal(
      commentPairsWithUpdate({ at, actorId: 4 }, null),
      false,
    );
    assert.equal(
      commentPairsWithUpdate(
        { at: new Date(at.getTime() + 120_001), actorId: 4 },
        { at, actorId: 4 },
      ),
      false,
    );
  });

  it("collapses a comment excerpt to one line and cuts it at 160 characters", () => {
    assert.equal(commentExcerpt("  hello \n world  "), "hello world");
    const long = "a".repeat(161);
    assert.equal(commentExcerpt(long).length, 161);
    assert.ok(commentExcerpt(long).endsWith("…"));
  });
});

describe("list derivation and graph fields", () => {
  it("uses the newest item update and ignores items with none", () => {
    const older = update("2026-09-01T00:00:00.000Z", "progress");
    const newer = update("2026-10-01T00:00:00.000Z", "state");
    assert.deepEqual(deriveListLastUpdate([null, older, newer]), newer);
    assert.equal(deriveListLastUpdate([null, null]), null);
  });

  it("keeps the actor on the chosen item update", () => {
    const chosen = { ...update("2026-10-01T00:00:00.000Z", "state"), actorId: 4 };
    assert.equal(deriveListLastUpdate([null, chosen])?.actorId, 4);
  });

  it("keeps the later item when timestamps match", () => {
    const first = update("2026-10-01T00:00:00.000Z", "state");
    const second = { ...update("2026-10-01T00:00:00.000Z", "progress"), oldValue: "10", newValue: "20" };
    assert.equal(deriveListLastUpdate([first, second])?.field, "progress");
  });

  it("puts last update and last comment on a graph node and clocks staleness from the update", () => {
    const lastUpdate = update("2026-08-01T00:00:00.000Z", "body");
    const lastComment = {
      at: "2026-10-01T00:00:00.000Z",
      excerpt: "noted",
      withUpdate: false,
    };
    assert.deepEqual(
      activityForGraphNode(
        { lastUpdate, lastComment },
        "2026-01-01T00:00:00.000Z",
      ),
      {
        lastUpdate,
        lastComment,
        signalAt: "2026-08-01T00:00:00.000Z",
      },
    );
  });

  it("falls back to createdAt when the record has no update, so a comment cannot refresh the clock", () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    assert.deepEqual(activityForGraphNode(undefined, createdAt), {
      lastUpdate: null,
      lastComment: null,
      signalAt: createdAt,
    });
    assert.equal(
      activityForGraphNode(
        {
          lastUpdate: null,
          lastComment: { at: "2026-10-01T00:00:00.000Z", excerpt: "only a comment", withUpdate: false },
        },
        createdAt,
      ).signalAt,
      createdAt,
    );
  });
});
