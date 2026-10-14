import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canvasMentionText } from "./canvasMentionText.js";
import { extractMentionTokens } from "./mentionTokens.js";

describe("canvas mention text", () => {
  it("reads live text elements and falls back to originalText", () => {
    const text = canvasMentionText({
      elements: [
        { type: "text", text: "See #T0042" },
        { type: "text", originalText: "Also [N0012]" },
        { type: "text", text: "prefer text", originalText: "ignore this #I0009" },
      ],
    });
    assert.deepEqual(extractMentionTokens(text), [
      { entityType: "task", number: 42 },
      { entityType: "document", number: 12 },
    ]);
  });

  it("skips deleted text, non-text elements, and frame names", () => {
    const text = canvasMentionText({
      elements: [
        { type: "text", text: "#T0001", isDeleted: true },
        { type: "rectangle", text: "#T0002" },
        { type: "frame", name: "#T0003" },
        { type: "text", text: "Keep #P0004" },
      ],
      appState: { name: "#T0005" },
    });
    assert.deepEqual(extractMentionTokens(text), [{ entityType: "project", number: 4 }]);
  });

  it("returns empty text when the scene has no elements", () => {
    assert.equal(canvasMentionText(null), "");
    assert.equal(canvasMentionText({}), "");
    assert.equal(canvasMentionText({ elements: "nope" }), "");
  });
});
