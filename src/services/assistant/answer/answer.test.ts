import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AiChatMessage } from "@taskmesh/ai-provider-contract";
import { renderContext } from "../contextAssembly.js";
import { loadPrompt } from "../promptRegistry.js";
import type { ResolvedRef } from "./citations.js";
import { citableRefs } from "./citations.js";
import { selectAnswerHistory } from "./messages.js";
import { answerContextRequest, NOTHING_TO_ANSWER_FROM, runAnswer } from "./service.js";

const RESOLVED = new Map<string, ResolvedRef>([
  ["P0004", { entityType: "project", entityId: 4 }],
  ["N0002", { entityType: "document", entityId: 42 }],
]);

function projectPacket() {
  return renderContext({
    feature: "answer",
    budgetTokens: 8_000,
    focus: { ref: "P0004", title: "TaskMesh", body: "Personal tracker" },
    instanceInstructions: "Be brief",
    hits: [
      {
        id: 9,
        ref: "N0002",
        title: "Spec",
        page: 3,
        body: "Citations use display numbers.",
        score: 1,
      },
    ],
  });
}

describe("answer prompt", () => {
  it("loads the versioned answer prompt", () => {
    const prompt = loadPrompt({ id: "answer" });
    assert.equal(prompt.id, "answer");
    assert.equal(prompt.version, 1);
    assert.match(prompt.body, /display number/);
  });
});

describe("answer context request", () => {
  it("searches on the current question", () => {
    const request = answerContextRequest({
      actorId: 1,
      projectId: 4,
      question: "Where is the citation rule?",
    });
    assert.deepEqual(request, {
      actorId: 1,
      feature: "answer",
      entityType: "project",
      entityId: 4,
      query: "Where is the citation rule?",
    });
  });
});

describe("answer history", () => {
  it("keeps the last six turns and cuts each one at 2,000 characters", () => {
    const history = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: index === 7 ? `${"a".repeat(2_000)}Z` : `turn ${index}`,
    }));
    const selected = selectAnswerHistory(history);
    assert.deepEqual(
      selected.map((turn) => turn.content.slice(0, 8)),
      ["turn 2", "turn 3", "turn 4", "turn 5", "turn 6", "aaaaaaaa"],
    );
    assert.equal(selected[5]?.content.length, 2_000);
    assert.equal(selected[5]?.content.endsWith("Z"), false);
  });
});

describe("answer grounding", () => {
  it("does not call the model when the project is excluded or nothing is citable", async () => {
    let calls = 0;
    const complete = async () => {
      calls += 1;
      return { text: "guess" };
    };
    const excluded = await runAnswer({
      question: "What is open?",
      history: [],
      prompt: "prompt",
      packet: renderContext({ feature: "answer", budgetTokens: 8_000, blocked: "project_excluded" }),
      resolved: RESOLVED,
      complete,
    });
    const instructionsOnly = await runAnswer({
      question: "What is open?",
      history: [],
      prompt: "prompt",
      packet: renderContext({
        feature: "answer",
        budgetTokens: 8_000,
        instanceInstructions: "Be brief",
      }),
      resolved: RESOLVED,
      complete,
    });
    assert.equal(calls, 0);
    assert.deepEqual(excluded, {
      answer: NOTHING_TO_ANSWER_FROM,
      citations: [],
      grounded: false,
      auditId: null,
    });
    assert.deepEqual(instructionsOnly, excluded);
  });

  it("keeps a citation only when the ref and page were in the packet", async () => {
    const packet = projectPacket();
    assert.deepEqual(citableRefs(packet).map((item) => item.ref), ["P0004", "N0002"]);
    assert.deepEqual(citableRefs(packet).find((item) => item.ref === "N0002")?.pages, [3]);

    const reply = "See P0004. The rule is in N0002 p.9 and again in N0002 p.3. Also T9999.";
    let seen: AiChatMessage[] = [];
    const history = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `turn ${index}`,
    }));
    const result = await runAnswer({
      question: "Where is the citation rule?",
      history,
      prompt: "Answer only from context.",
      packet,
      resolved: RESOLVED,
      complete: async (messages) => {
        seen = messages;
        return { text: reply };
      },
    });

    assert.equal(result.answer, reply);
    assert.equal(result.grounded, true);
    assert.deepEqual(result.citations, [
      { ref: "P0004", page: null, entityType: "project", entityId: 4 },
      { ref: "N0002", page: 3, entityType: "document", entityId: 42 },
    ]);
    assert.equal(seen[0]?.content, "Answer only from context.");
    assert.equal(seen.at(-1)?.role, "user");
    assert.match(seen.at(-1)?.content ?? "", /Where is the citation rule\?/);
    const joined = seen.map((message) => message.content).join("\n");
    assert.equal(joined.includes("turn 0"), false);
    assert.equal(joined.includes("turn 1"), false);
    assert.equal(joined.includes("turn 2"), true);
    assert.equal(joined.includes("turn 7"), true);
    assert.equal(result.auditId, null);
  });

  it("returns the audit id from the model call", async () => {
    const result = await runAnswer({
      question: "Where is the citation rule?",
      history: [],
      prompt: "Answer only from context.",
      packet: projectPacket(),
      resolved: RESOLVED,
      complete: async () => ({ text: "See P0004.", auditId: 17 }),
    });
    assert.equal(result.auditId, 17);
    assert.equal(result.grounded, true);
    assert.equal(result.citations[0]?.ref, "P0004");
  });
});
