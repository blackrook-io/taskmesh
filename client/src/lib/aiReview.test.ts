import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  diffLines,
  groupByProject,
  isDeleteProposal,
  proposalExpired,
  proposalHeading,
} from "./aiReview.ts";

describe("groupByProject", () => {
  it("groups by project id and leaves records with no project last", () => {
    const groups = groupByProject([
      { id: "a", projectId: 4 },
      { id: "b", projectId: null },
      { id: "c", projectId: 2 },
      { id: "d", projectId: 4 },
    ]);
    assert.deepEqual(
      groups.map((group) => ({ label: group.label, ids: group.items.map((item) => item.id) })),
      [
        { label: "Project #2", ids: ["c"] },
        { label: "Project #4", ids: ["a", "d"] },
        { label: "No project", ids: ["b"] },
      ],
    );
  });
});

describe("proposal review helpers", () => {
  it("marks a proposal expired after the target moved or was already missing", () => {
    assert.equal(proposalExpired({}), false);
    assert.equal(proposalExpired({ stale: true }), true);
    assert.equal(proposalExpired({ targetMissing: true }), true);
  });

  it("recognizes a delete-shaped proposal", () => {
    assert.equal(isDeleteProposal({ action: "create", method: "POST" }), false);
    assert.equal(isDeleteProposal({ action: "delete", method: "POST" }), true);
    assert.equal(isDeleteProposal({ action: "update", method: "DELETE" }), true);
  });

  it("shows additions for creates and before-to-after for updates", () => {
    assert.deepEqual(diffLines({ title: "New" }), [
      { key: "title", kind: "add", beforeText: null, afterText: "New" },
    ]);
    assert.deepEqual(diffLines({ title: "New" }, { title: "Old" }), [
      { key: "title", kind: "change", beforeText: "Old", afterText: "New" },
    ]);
  });

  it("names a create with its project", () => {
    assert.equal(
      proposalHeading({ action: "create", entityType: "task", projectId: 4 }),
      "Create task · project #4",
    );
  });
});
