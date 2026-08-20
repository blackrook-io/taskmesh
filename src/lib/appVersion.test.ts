import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeResponseMeta, readPackageVersion, releasedAtFromSidecar } from "./appVersion.js";

const meta = {
  version: "0.1.1",
  createdAt: "2026-08-20T12:11:42.000Z",
  releasedAt: "2026-08-20T12:20:00.000Z",
};

describe("appVersion", () => {
  it("reads version from package.json", () => {
    assert.match(readPackageVersion(), /^\d+\.\d+\.\d+$/);
  });

  it("uses sidecar releasedAt only when version matches", () => {
    assert.equal(
      releasedAtFromSidecar({ version: "0.1.1", releasedAt: meta.releasedAt }, "0.1.1"),
      meta.releasedAt,
    );
    assert.equal(
      releasedAtFromSidecar({ version: "0.1.0", releasedAt: meta.releasedAt }, "0.1.1"),
      null,
    );
    assert.equal(releasedAtFromSidecar(null, "0.1.1"), null);
    assert.equal(releasedAtFromSidecar({ version: "0.1.1", releasedAt: "nope" }, "0.1.1"), null);
  });

  it("merges meta onto JSON objects without dropping extra keys", () => {
    const out = mergeResponseMeta({ data: [1], meta: { extra: true } }, meta) as {
      data: number[];
      meta: Record<string, unknown>;
    };
    assert.deepEqual(out.data, [1]);
    assert.equal(out.meta.extra, true);
    assert.equal(out.meta.version, "0.1.1");
    assert.equal(out.meta.releasedAt, meta.releasedAt);
  });

  it("leaves non-objects unchanged", () => {
    assert.equal(mergeResponseMeta("ok", meta), "ok");
    assert.deepEqual(mergeResponseMeta([1], meta), [1]);
  });
});
