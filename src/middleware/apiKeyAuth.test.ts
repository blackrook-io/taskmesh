import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";
import { extractPresentedApiKey } from "./apiKeyAuth.js";
import { parseApiKeyExpiresAt, MAX_API_KEY_TTL_MS } from "../services/apiKeys.js";
import { generateApiKey, hashApiKeySecret } from "../lib/apiKeyCrypto.js";

function mockReq(headers: Record<string, string | undefined>): Request {
  return {
    get(name: string) {
      const key = name.toLowerCase();
      if (key === "authorization") return headers.authorization;
      if (key === "x-api-key") return headers["x-api-key"];
      return undefined;
    },
  } as Request;
}

describe("extractPresentedApiKey", () => {
  it("reads Bearer and X-API-Key", () => {
    assert.equal(
      extractPresentedApiKey(mockReq({ authorization: "Bearer taskmesh_rw_abc" })).rawKey,
      "taskmesh_rw_abc",
    );
    assert.equal(
      extractPresentedApiKey(mockReq({ "x-api-key": "taskmesh_ro_xyz" })).rawKey,
      "taskmesh_ro_xyz",
    );
  });

  it("flags conflicting headers", () => {
    const r = extractPresentedApiKey(
      mockReq({ authorization: "Bearer a", "x-api-key": "b" }),
    );
    assert.equal(r.conflict, true);
    assert.equal(r.rawKey, null);
  });

  it("accepts matching dual headers", () => {
    const r = extractPresentedApiKey(
      mockReq({ authorization: "Bearer same", "x-api-key": "same" }),
    );
    assert.equal(r.conflict, false);
    assert.equal(r.rawKey, "same");
  });
});

describe("apiKeyCrypto", () => {
  it("embeds ro/rw in the key string and hashes the full secret", () => {
    const rw = generateApiKey("readwrite");
    const ro = generateApiKey("readonly");
    assert.match(rw.rawKey, /^taskmesh_rw_[0-9a-f]{64}$/);
    assert.match(ro.rawKey, /^taskmesh_ro_[0-9a-f]{64}$/);
    assert.equal(rw.keyHash, hashApiKeySecret(rw.rawKey));
    assert.notEqual(rw.keyHash, hashApiKeySecret(rw.rawKey.replace("_rw_", "_ro_")));
  });
});

describe("parseApiKeyExpiresAt", () => {
  it("rejects past and >60d horizons", () => {
    const now = new Date("2026-08-27T00:00:00.000Z");
    assert.throws(() => parseApiKeyExpiresAt("2026-08-26T00:00:00.000Z", now));
    assert.throws(() =>
      parseApiKeyExpiresAt(
        new Date(now.getTime() + MAX_API_KEY_TTL_MS + 60_000).toISOString(),
        now,
      ),
    );
    const ok = parseApiKeyExpiresAt(
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      now,
    );
    assert.ok(ok.getTime() > now.getTime());
  });
});
