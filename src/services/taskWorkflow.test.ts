import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allowedNextStates,
  assertImportedInitialState,
  assertInitialState,
  assertTaskTagAdd,
  enforceTaskPatch,
  TaskWorkflowError,
} from "./taskWorkflow.js";

const STATES = [
  "new",
  "blocked",
  "ready",
  "in_progress",
  "pending",
  "complete",
  "canceled",
  "on_hold",
  "deleted",
] as const;

function capture(run: () => void): TaskWorkflowError | null {
  try {
    run();
    return null;
  } catch (err) {
    assert.ok(err instanceof TaskWorkflowError);
    return err;
  }
}

function expectedCode(
  from: string,
  to: string,
  canReopen: boolean,
  comment: string | undefined,
): string | null {
  if (from === to) return null;
  const reopen = to === "ready" && (from === "complete" || from === "canceled");
  if (reopen && !canReopen) return "reopen_forbidden";
  if (!allowedNextStates(from, canReopen).includes(to)) return "invalid_transition";
  const needsComment = to === "canceled" || reopen;
  if (needsComment && !comment?.trim()) return "state_comment_required";
  return null;
}

describe("task workflow transitions", () => {
  for (const from of STATES) {
    for (const to of STATES) {
      for (const canReopen of [false, true]) {
        const label = `${from} → ${to} (${canReopen ? "manager" : "member"})`;
        it(label, () => {
          for (const comment of [undefined, "because"]) {
            const code = expectedCode(from, to, canReopen, comment);
            const err = capture(() =>
              enforceTaskPatch({
                fromState: from,
                canReopen,
                patch: { state: to, stateComment: comment },
              }),
            );
            assert.equal(err?.code ?? null, code);
            if (code === "invalid_transition" || code === "reopen_forbidden") {
              assert.match(err?.message ?? "", /Allowed next states:/);
            }
          }
        });
      }
    }
  }

  it("allows a field edit on an open task and rejects it when closed", () => {
    assert.equal(
      capture(() =>
        enforceTaskPatch({
          fromState: "ready",
          canReopen: false,
          patch: { title: "Next" },
        }),
      ),
      null,
    );
    const closed = capture(() =>
      enforceTaskPatch({
        fromState: "complete",
        canReopen: true,
        patch: { title: "Next", state: "ready", stateComment: "reopen" },
      }),
    );
    assert.equal(closed?.code, "task_closed");
  });

  it("allows reopen when the comment is the only extra field", () => {
    assert.equal(
      capture(() =>
        enforceTaskPatch({
          fromState: "complete",
          canReopen: true,
          patch: { state: "ready", stateComment: "needed again" },
        }),
      ),
      null,
    );
  });
});

describe("task workflow create, import, and tags", () => {
  it("lets create and import start only at Draft", () => {
    assert.equal(capture(() => assertInitialState(undefined)), null);
    assert.equal(capture(() => assertInitialState("new")), null);
    assert.equal(capture(() => assertImportedInitialState(undefined)), null);
    assert.equal(capture(() => assertImportedInitialState("")), null);
    assert.equal(capture(() => assertImportedInitialState("  new  ")), null);
    const created = capture(() => assertInitialState("ready"));
    const imported = capture(() => assertImportedInitialState("in_progress"));
    assert.equal(created?.code, "invalid_transition");
    assert.equal(imported?.code, created?.code);
    assert.equal(imported?.message, created?.message);
  });

  it("refuses a fourth tag and any tag add on a closed task", () => {
    assert.equal(capture(() => assertTaskTagAdd("ready", 2)), null);
    assert.equal(capture(() => assertTaskTagAdd("ready", 3))?.code, "tag_cap");
    assert.equal(capture(() => assertTaskTagAdd("canceled", 0))?.code, "task_closed");
  });
});

describe("task workflow call sites", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const read = (path: string) => readFileSync(join(root, path), "utf8");

  it("project PATCH and standalone PATCH call enforceTaskPatch", () => {
    assert.match(read("src/routes/v1/tasks.ts"), /enforceTaskPatch\(/);
    assert.match(read("src/routes/v1/standaloneTasks.ts"), /enforceTaskPatch\(/);
    const refused = capture(() =>
      enforceTaskPatch({
        fromState: "ready",
        canReopen: false,
        patch: { state: "complete" },
      }),
    );
    assert.equal(refused?.code, "invalid_transition");
    assert.match(refused?.message ?? "", /In Progress, Canceled/);
  });

  it("Assistant task proposals call enforceTaskPatch", () => {
    const src = read("src/services/assistant/tools.ts");
    assert.match(src, /enforceTaskPatch\(/);
    const refused = capture(() =>
      enforceTaskPatch({
        fromState: "in_progress",
        canReopen: false,
        patch: { state: "ready" },
      }),
    );
    assert.equal(refused?.code, "invalid_transition");
  });

  it("import uses the Draft-only initial state check", () => {
    assert.match(read("src/routes/v1/importExport.ts"), /assertImportedInitialState\(/);
  });

  it("task taggings use the tag rules", () => {
    const src = read("src/routes/v1/taggings.ts");
    assert.match(src, /assertTaskTagAdd\(/);
    assert.match(src, /assertTaskTagRemove\(/);
  });
});
