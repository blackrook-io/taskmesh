import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ZodError } from "zod";
import { defaultAiPermissionSettings } from "../aiTiers.js";
import { CaptureError } from "./service.js";
import { executeCaptureConfirm, proposalFromConfirm, confirmBodySchema } from "./confirm.js";
import type { CaptureProposal } from "./types.js";

function permission(off: string[] = [], featuresOff: string[] = []) {
  return {
    settings: defaultAiPermissionSettings(),
    off,
    policy: { featuresOff },
  };
}

function writers() {
  const calls: string[] = [];
  return {
    calls,
    create: async (proposal: CaptureProposal) => {
      calls.push(`create:${proposal.recordType}`);
      return { id: 9, number: proposal.recordType === "todo" ? 3 : proposal.recordType === "idea" ? 1 : 58 };
    },
    addToList: async (listId: number) => {
      calls.push(`list:${listId}`);
    },
    addTag: async (_type: string, _id: number, name: string) => {
      calls.push(`tag:${name}`);
      return null;
    },
    addLink: async () => {
      calls.push("link");
      return null;
    },
  };
}

const taskBody = {
  recordType: "task",
  title: "Book the exam slot",
  description: "Morning",
  dueDate: "2026-10-16",
  priority: "urgent",
  projectId: 4,
  parentId: 12,
  tags: ["aws"],
  links: [{ entityType: "document", id: 7 }],
};

describe("capture confirm", () => {
  it("rejects a missing title", () => {
    assert.throws(() => confirmBodySchema.parse({ recordType: "task", title: "  " }), ZodError);
  });

  it("strips project, list, date, and priority from an idea", () => {
    const proposal = proposalFromConfirm(
      confirmBodySchema.parse({
        recordType: "idea",
        title: "Sketch",
        projectId: 4,
        listId: 2,
        parentId: 3,
        dueDate: "2026-10-16",
        priority: "high",
      }),
    );
    assert.equal(proposal.project, null);
    assert.equal(proposal.list, null);
    assert.equal(proposal.parent, null);
    assert.equal(proposal.dueDate, null);
    assert.equal(proposal.priority, null);
  });

  it("creates a task, a todo on a list, and an idea through the writers", async () => {
    const task = writers();
    const created = await executeCaptureConfirm({
      actorUserId: 1,
      body: taskBody,
      permission: permission(),
      accessFor: async () => "full",
      writers: task,
    });
    assert.equal(created.ref, "T0058");
    assert.deepEqual(task.calls, ["create:task", "tag:aws", "link"]);

    const todo = writers();
    const todoCreated = await executeCaptureConfirm({
      actorUserId: 1,
      body: { recordType: "todo", title: "Pack", listId: 5, projectId: 4 },
      permission: permission(),
      accessFor: async () => "full",
      writers: todo,
    });
    assert.equal(todoCreated.ref, "D0003");
    assert.deepEqual(todo.calls, ["create:todo", "list:5"]);

    const idea = writers();
    const ideaCreated = await executeCaptureConfirm({
      actorUserId: 1,
      body: { recordType: "idea", title: "Sketch", projectId: 4 },
      permission: permission(),
      writers: idea,
    });
    assert.equal(ideaCreated.ref, "I0001");
    assert.deepEqual(idea.calls, ["create:idea"]);
  });

  it("does not write when policy denies the create", async () => {
    const sink = writers();
    const audits: string[] = [];
    await assert.rejects(
      () =>
        executeCaptureConfirm({
          actorUserId: 1,
          body: taskBody,
          permission: permission(["propose_create"]),
          accessFor: async () => "full",
          writers: sink,
          audit: async (row) => {
            audits.push(row.decision);
          },
        }),
      (err: unknown) => err instanceof CaptureError && err.status === 403 && err.code === "ai_policy_denied",
    );
    assert.deepEqual(sink.calls, []);
    assert.deepEqual(audits, ["deny"]);
  });
});
