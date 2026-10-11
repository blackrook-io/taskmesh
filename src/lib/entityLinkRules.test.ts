import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  entityEndKey,
  filterLinksVisibleAtBothEnds,
  isLinkOrigin,
  isLinkRelation,
  isSelfLink,
  linkIdentityKey,
} from "./entityLinkRules.js";

describe("entity link rules", () => {
  it("accepts the four relations and both origins", () => {
    assert.equal(isLinkRelation("relates_to"), true);
    assert.equal(isLinkRelation("references"), true);
    assert.equal(isLinkRelation("supports"), true);
    assert.equal(isLinkRelation("part_of"), true);
    assert.equal(isLinkRelation("depends_on"), false);
    assert.equal(isLinkOrigin("manual"), true);
    assert.equal(isLinkOrigin("mention"), true);
    assert.equal(isLinkOrigin("suggested"), false);
  });

  it("rejects a link from a record to itself", () => {
    assert.equal(isSelfLink("task", 12, "task", 12), true);
    assert.equal(isSelfLink("task", 12, "document", 12), false);
    assert.equal(isSelfLink("task", 12, "task", 13), false);
  });

  it("keeps origin in the identity key so mention and manual can coexist", () => {
    const shared = {
      srcType: "task",
      srcId: 1,
      dstType: "document",
      dstId: 7,
      relation: "references",
    };
    const manual = linkIdentityKey({ ...shared, origin: "manual" });
    const mention = linkIdentityKey({ ...shared, origin: "mention" });
    assert.notEqual(manual, mention);
    assert.equal(manual, linkIdentityKey({ ...shared, origin: "manual" }));
  });

  it("drops a link when either end is invisible, including a soft-deleted task", () => {
    const links = [
      {
        id: 1,
        src: { entityType: "project", id: 4 },
        dst: { entityType: "task", id: 10 },
      },
      {
        id: 2,
        src: { entityType: "project", id: 4 },
        dst: { entityType: "task", id: 11 },
      },
      {
        id: 3,
        src: { entityType: "document", id: 3 },
        dst: { entityType: "project", id: 4 },
      },
    ];
    const visible = new Set([
      entityEndKey("project", 4),
      entityEndKey("task", 10),
    ]);
    const kept = filterLinksVisibleAtBothEnds(links, visible);
    assert.deepEqual(
      kept.map((link) => link.id),
      [1],
    );
  });
});
