import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHUNK_OVERLAP, CHUNK_TARGET, chunkMarkdown, titleChunkText } from "./chunk.js";
import { shouldEmbedRecord, reusedEmbedding } from "./embedDecision.js";
import { reciprocalRankFusion } from "./fusion.js";
import { toSimpleTsQuery } from "./queryText.js";

describe("chunkMarkdown", () => {
  it("keeps the heading with the section", () => {
    const chunks = chunkMarkdown("Intro line\n\n## Costs\n\nThe budget is 12.");
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]?.heading, null);
    assert.match(chunks[0]?.content ?? "", /Intro line/);
    assert.equal(chunks[1]?.heading, "Costs");
    assert.match(chunks[1]?.content ?? "", /budget is 12/);
    assert.ok((chunks[1]?.startOffset ?? 0) > 0);
  });

  it("overlaps a long section", () => {
    const paragraph = `${"word ".repeat(80).trim()}\n\n`;
    const text = paragraph.repeat(8);
    const chunks = chunkMarkdown(text);
    assert.ok(chunks.length > 1);
    const firstEnd = chunks[0]?.endOffset ?? 0;
    const secondStart = chunks[1]?.startOffset ?? 0;
    assert.ok(secondStart < firstEnd);
    assert.ok(firstEnd - secondStart <= CHUNK_OVERLAP + 2);
    assert.ok((chunks[0]?.content.length ?? 0) <= CHUNK_TARGET);
  });
});

describe("titleChunkText", () => {
  it("includes the formatted display number", () => {
    assert.equal(titleChunkText("task", 208, "Knowledge index"), "T0208 Knowledge index");
    assert.equal(titleChunkText("document", 12, "Notes"), "N0012 Notes");
  });
});

describe("shouldEmbedRecord", () => {
  it("embeds records without a project and skips excluded projects", () => {
    assert.equal(shouldEmbedRecord(null, null), true);
    assert.equal(shouldEmbedRecord(4, "full"), true);
    assert.equal(shouldEmbedRecord(4, "read_only"), true);
    assert.equal(shouldEmbedRecord(4, "excluded"), false);
    assert.equal(shouldEmbedRecord(4, null), false);
  });
});

describe("reusedEmbedding", () => {
  it("reuses a vector when the hash and model match", () => {
    const embedding = [0.25, 0.5];
    const previous = { hash: "abc", model: "nomic-embed-text", embedding: Array(768).fill(0.1) };
    assert.equal(reusedEmbedding(previous, "abc", "nomic-embed-text", true), previous.embedding);
    assert.equal(reusedEmbedding(previous, "other", "nomic-embed-text", true), undefined);
    assert.equal(reusedEmbedding(previous, "abc", "nomic-embed-text", false), null);
    assert.equal(embedding.length, 2);
  });
});

describe("reciprocalRankFusion", () => {
  it("ranks a hit in both lists above a hit in one", () => {
    const fused = reciprocalRankFusion([
      ["a", "b"],
      ["b", "c"],
    ]);
    assert.equal(fused[0]?.id, "b");
    assert.ok((fused[0]?.score ?? 0) > (fused[1]?.score ?? 0));
  });
});

describe("toSimpleTsQuery", () => {
  it("prefixes only the last token", () => {
    assert.equal(toSimpleTsQuery("Task mesh"), "task & mesh:*");
    assert.equal(toSimpleTsQuery("T0208"), "t0208:*");
    assert.equal(toSimpleTsQuery("..."), null);
  });
});
