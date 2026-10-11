import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseGraphRelations,
  walkNeighbourhood,
  type GraphEdge,
  type GraphNeighbour,
} from "./graphWalk.js";

function edge(
  source: string,
  target: string,
  relation: string,
  origin: string | null = null,
): GraphEdge {
  return { source, target, relation, origin };
}

function expander(edges: GraphEdge[], done = new Set<string>()) {
  return async (keys: string[]): Promise<GraphNeighbour[]> => {
    const frontier = new Set(keys);
    const out: GraphNeighbour[] = [];
    for (const item of edges) {
      const sourceIn = frontier.has(item.source);
      const targetIn = frontier.has(item.target);
      if (!sourceIn && !targetIn) continue;
      const key = sourceIn && !targetIn ? item.target : item.source;
      out.push({ key, done: done.has(key), edge: item });
    }
    return out;
  };
}

const allRelations = new Set(["in_project", "depends_on", "relates_to", "child_of"]);

describe("graph neighbourhood walk", () => {
  it("stops at the requested depth", async () => {
    const edges = [
      edge("project:1", "task:1", "in_project"),
      edge("task:2", "task:1", "child_of"),
      edge("task:3", "task:2", "child_of"),
    ];
    const result = await walkNeighbourhood({
      root: "project:1",
      depth: 1,
      cap: 300,
      hideDone: false,
      relations: allRelations,
      isVisible: () => true,
      expand: expander(edges),
    });
    assert.deepEqual(result.keys, ["project:1", "task:1"]);
    assert.equal(result.truncated, false);
  });

  it("keeps only the requested relations", async () => {
    const edges = [
      edge("project:1", "task:1", "in_project"),
      edge("task:1", "task:9", "depends_on"),
      edge("task:1", "document:3", "relates_to", "manual"),
    ];
    const result = await walkNeighbourhood({
      root: "project:1",
      depth: 2,
      cap: 300,
      hideDone: false,
      relations: new Set(["in_project"]),
      isVisible: () => true,
      expand: expander(edges),
    });
    assert.deepEqual(result.keys, ["project:1", "task:1"]);
    assert.deepEqual(
      result.edges.map((item) => item.relation),
      ["in_project"],
    );
  });

  it("drops an invisible neighbour and does not walk through it", async () => {
    const edges = [
      edge("project:1", "task:1", "in_project"),
      edge("task:1", "document:8", "relates_to", "manual"),
      edge("document:8", "idea:2", "relates_to", "manual"),
    ];
    const result = await walkNeighbourhood({
      root: "project:1",
      depth: 3,
      cap: 300,
      hideDone: false,
      relations: allRelations,
      isVisible: (key) => key !== "document:8",
      expand: expander(edges),
    });
    assert.deepEqual(result.keys, ["project:1", "task:1"]);
    assert.equal(
      result.edges.some((item) => item.source === "document:8" || item.target === "document:8"),
      false,
    );
  });

  it("sets truncated when the cap leaves neighbours out", async () => {
    const edges = [
      edge("project:1", "task:1", "in_project"),
      edge("project:1", "task:2", "in_project"),
      edge("project:1", "task:3", "in_project"),
    ];
    const result = await walkNeighbourhood({
      root: "project:1",
      depth: 1,
      cap: 2,
      hideDone: false,
      relations: allRelations,
      isVisible: () => true,
      expand: expander(edges),
    });
    assert.equal(result.keys.length, 2);
    assert.equal(result.keys[0], "project:1");
    assert.equal(result.truncated, true);
    assert.equal(result.edges.length, 1);
  });

  it("does not expand through a done node when hideDone is set", async () => {
    const edges = [
      edge("project:1", "task:1", "in_project"),
      edge("task:2", "task:1", "child_of"),
    ];
    const result = await walkNeighbourhood({
      root: "project:1",
      depth: 3,
      cap: 300,
      hideDone: true,
      relations: allRelations,
      isVisible: () => true,
      expand: expander(edges, new Set(["task:1"])),
    });
    assert.deepEqual(result.keys, ["project:1"]);
    assert.equal(result.truncated, false);
  });

  it("rejects an unknown relation and omits tags by default", () => {
    assert.equal(parseGraphRelations(undefined).ok, true);
    const defaults = parseGraphRelations(undefined);
    assert.equal(defaults.ok && defaults.relations.has("tagged"), false);
    assert.equal(defaults.ok && defaults.relations.has("in_project"), true);
    const tagged = parseGraphRelations("tagged,in_project");
    assert.equal(tagged.ok && tagged.relations.has("tagged"), true);
    const unknown = parseGraphRelations("nope");
    assert.deepEqual(unknown, { ok: false, unknown: "nope" });
  });
});
