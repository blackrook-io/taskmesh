import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planFinishPresentation } from "./planProjection.ts";

describe("planFinishPresentation", () => {
  it("shows the range and the input that drove it", () => {
    assert.deepEqual(
      planFinishPresentation({
        driver: "critical_path",
        earliest: "2026-10-24",
        latest: "2026-10-30",
      }),
      { label: "Oct 24 – Oct 30", detail: "Driven by the critical path" },
    );
    assert.deepEqual(
      planFinishPresentation({
        driver: "velocity",
        earliest: "2026-10-21",
        latest: "2026-10-21",
      }),
      { label: "Oct 21", detail: "Driven by velocity" },
    );
  });

  it("uses the prompt and finished labels without a date", () => {
    assert.deepEqual(
      planFinishPresentation({ driver: "needs_capacity", earliest: null, latest: null }),
      { label: "Set weekly capacity", detail: null },
    );
    assert.deepEqual(
      planFinishPresentation({ driver: "needs_estimates", earliest: null, latest: null }),
      { label: "Add estimates to project a finish", detail: null },
    );
    assert.deepEqual(
      planFinishPresentation({ driver: "complete", earliest: "2026-10-14", latest: "2026-10-14" }),
      { label: "Finished", detail: null },
    );
  });
});
