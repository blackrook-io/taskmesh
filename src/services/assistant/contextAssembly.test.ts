import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encode } from "gpt-tokenizer/encoding/cl100k_base";
import {
  ContextAssemblyError,
  estimateTokens,
  renderContext,
  type ContextDraft,
} from "./contextAssembly.js";

function draft(patch: Partial<ContextDraft> = {}): ContextDraft {
  return {
    feature: "answer",
    budgetTokens: 8_000,
    instanceInstructions: "Instance rule: cite display numbers.",
    projectInstructions: "Project rule: T#### are dev tasks.",
    userInstructions: "User rule: never change due dates.",
    focus: {
      ref: "T0007",
      title: "Ship context",
      body: "Focus body for the record.",
    },
    parent: {
      ref: "P0004",
      title: "TaskMesh",
      body: "Parent project body.",
    },
    links: [
      { ref: "N0003", title: "Notes", body: "Linked note." },
      { ref: "T0002", title: "Earlier", body: "Linked task." },
    ],
    activity: [{ ref: "T0007", title: "activity 9", body: "State became Ready." }],
    hits: [
      { id: 2, ref: "T0008", title: "Low", body: "Lower score hit.", score: 0.2, page: null },
      { id: 1, ref: "N0009", title: "Spec", body: "Higher score hit.", score: 0.9, page: 2 },
    ],
    ...patch,
  };
}

describe("estimateTokens", () => {
  it("matches cl100k within 10 percent", () => {
    const samples = [
      "TaskMesh keeps project instructions with the record.",
      "T0209\n".repeat(40),
      "mixed Markdown **bold** and `code` plus a number 42.",
    ];
    for (const sample of samples) {
      const actual = encode(sample).length;
      const estimate = estimateTokens(sample);
      assert.ok(actual > 0);
      assert.ok(Math.abs(estimate - actual) / actual <= 0.1);
    }
  });
});

describe("renderContext", () => {
  it("orders sections, cites display numbers, and fences untrusted text", () => {
    const result = renderContext(draft());
    const text = result.text;
    const at = (needle: string) => text.indexOf(needle);
    assert.ok(at("feature: answer") >= 0);
    assert.ok(at("instructions:instance") < at("instructions:project"));
    assert.ok(at("instructions:project") < at("instructions:user"));
    assert.ok(at("instructions:user") < at("[T0007]"));
    assert.ok(at("[T0007]") < at("[P0004]"));
    assert.ok(at("[P0004]") < at("[N0003]"));
    assert.ok(at("[N0003]") < at("[T0002]"));
    assert.ok(at("[T0002]") < at("[T0007] activity 9"));
    assert.ok(at("[T0007] activity 9") < at("[N0009 p.2]"));
    assert.ok(at("[N0009 p.2]") < at("[T0008]"));
    assert.match(text, /<<<untrusted source="instructions:instance">>>/);
    assert.match(text, /<<<untrusted source="ref:t0007">>>/);
    assert.match(text, /<<<untrusted source="ref:n0009">>>/);
    assert.equal(result.blocked, null);
    assert.equal(result.estimatedTokens, estimateTokens(text));
    assert.ok(result.estimatedTokens <= result.budgetTokens);
  });

  it("is byte-identical for the same draft", () => {
    const input = draft();
    assert.deepEqual(renderContext(input), renderContext(input));
  });

  it("redacts secrets inside instructions", () => {
    const result = renderContext(
      draft({
        instanceInstructions: "prefix sk-abcdefghijklmnopqrstuvwxyz suffix",
      }),
    );
    assert.match(result.text, /\[redacted\]/);
    assert.doesNotMatch(result.text, /sk-abcdefghijklmnopqrstuvwxyz/);
  });

  it("returns an empty packet when the project is excluded", () => {
    const result = renderContext(
      draft({
        blocked: "project_excluded",
        instanceInstructions: "do not send sk-abcdefghijklmnopqrstuvwxyz",
        focus: { ref: "T0007", title: "Hidden", body: "secret body" },
      }),
    );
    assert.equal(result.text, "");
    assert.equal(result.estimatedTokens, 0);
    assert.equal(result.blocked, "project_excluded");
    assert.deepEqual(result.items, []);
    assert.deepEqual(result.dropped, []);
    assert.doesNotMatch(JSON.stringify(result), /secret body/);
    assert.doesNotMatch(JSON.stringify(result), /sk-/);
  });

  it("truncates the first item that does not fit and drops the rest", () => {
    const result = renderContext(
      draft({
        budgetTokens: 256,
        focus: { ref: "T0001", title: "Long", body: "word ".repeat(4_000) },
        links: [{ ref: "N0002", title: "Later", body: "should drop" }],
        hits: [],
        activity: [],
        parent: null,
      }),
    );
    assert.ok(result.estimatedTokens <= 256);
    assert.match(result.text, /\[T0001\]/);
    assert.doesNotMatch(result.text, /should drop/);
    assert.ok(result.dropped.some((row) => row.section === "focus" && row.reason === "truncated"));
    assert.ok(result.dropped.some((row) => row.ref === "N0002" && row.reason === "budget"));
  });

  it("rejects a feature name outside the allowed shape", () => {
    assert.throws(
      () => renderContext(draft({ feature: "Answer" })),
      (err: unknown) => err instanceof ContextAssemblyError && err.code === "invalid_feature",
    );
  });
});
