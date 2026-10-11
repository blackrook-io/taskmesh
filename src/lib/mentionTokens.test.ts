import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractMentionTokens } from "./mentionTokens.js";

describe("mention tokens", () => {
  it("treats case and padding as the same record", () => {
    const tokens = extractMentionTokens("See #T31, #t0031, and #T0031.");
    assert.deepEqual(tokens, [{ entityType: "task", number: 31 }]);
  });

  it("reads every record prefix and the editor label", () => {
    const tokens = extractMentionTokens("Idea #I0002, doc [N0012], list #L7.");
    assert.deepEqual(tokens, [
      { entityType: "idea", number: 2 },
      { entityType: "todo_list", number: 7 },
      { entityType: "document", number: 12 },
    ]);
  });

  it("ignores a bare display number", () => {
    assert.deepEqual(extractMentionTokens("Task T0031 is not a mention."), []);
  });

  it("ignores fenced code and inline code", () => {
    const markdown = [
      "Keep #P0003.",
      "```",
      "#T0099",
      "```",
      "Also ` [D0004] ` and #D0004.",
    ].join("\n");
    assert.deepEqual(extractMentionTokens(markdown), [
      { entityType: "project", number: 3 },
      { entityType: "todo", number: 4 },
    ]);
  });

  it("reads the label inside the saved anchor", () => {
    const markdown = '<a href="/tasks?open=10">[T0010] Title</a>';
    assert.deepEqual(extractMentionTokens(markdown), [{ entityType: "task", number: 10 }]);
  });
});
