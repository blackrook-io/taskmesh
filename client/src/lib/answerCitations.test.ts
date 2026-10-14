import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { citationRecordPath, linkCitedRefs, type CitationTarget } from "./answerCitations.ts";

function cite(over: Partial<CitationTarget> & Pick<CitationTarget, "ref" | "entityType" | "entityId">): CitationTarget {
  const page = over.page ?? null;
  return {
    ref: over.ref,
    page,
    entityType: over.entityType,
    entityId: over.entityId,
    href: over.href ?? citationRecordPath(4, { entityType: over.entityType, entityId: over.entityId, page }),
  };
}

describe("citation paths", () => {
  it("opens a document on the cited PDF page", () => {
    assert.equal(
      citationRecordPath(4, { entityType: "document", entityId: 42, page: 3 }),
      "/projects/4?tab=documents&doc=42&page=3",
    );
  });

  it("opens a ToDo on its list", () => {
    assert.equal(
      citationRecordPath(4, { entityType: "todo", entityId: 9, page: null }, { todoListId: 3 }),
      "/projects/4?tab=todo_lists&list=3&todo=9",
    );
  });
});

describe("cited markdown links", () => {
  const citations = [
    cite({ ref: "P0004", entityType: "project", entityId: 4 }),
    cite({ ref: "N0002", entityType: "document", entityId: 42, page: 3 }),
  ];

  it("links a cited ref and its validated page", () => {
    const linked = linkCitedRefs("See P0004. The rule is in N0002 p.3. Also T9999.", citations);
    assert.match(linked, /\[P0004\]\(\/projects\/4\)/);
    assert.match(linked, /\[N0002 p\.3\]\(\/projects\/4\?tab=documents&doc=42&page=3\)/);
    assert.match(linked, /Also T9999\./);
    assert.equal(linked.includes("[T9999]"), false);
  });

  it("links the ref when the page was not kept", () => {
    const linked = linkCitedRefs("See N0002 p.9.", citations);
    assert.match(linked, /\[N0002\]\(\/projects\/4\?tab=documents&doc=42\)/);
    assert.match(linked, /p\.9/);
    assert.equal(linked.includes("page=9"), false);
  });

  it("leaves refs inside code and existing links alone", () => {
    const source = "Use `N0002` or\n```\nP0004\n```\nSee [N0002](https://example.com). Then P0004.";
    const linked = linkCitedRefs(source, citations);
    assert.match(linked, /Use `N0002`/);
    assert.match(linked, /```\nP0004\n```/);
    assert.match(linked, /\[N0002\]\(https:\/\/example\.com\)/);
    assert.match(linked, /Then \[P0004\]\(\/projects\/4\)\./);
  });
});
