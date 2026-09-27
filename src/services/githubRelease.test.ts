import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { systemRouter } from "../routes/v1/system.js";
import { requireAdministrator } from "../middleware/requireAdministrator.js";
import {
  clearGithubReleaseCache,
  latestStableRelease,
  parseLatestRelease,
  updateAvailable,
  type StableRelease,
} from "./githubRelease.js";

const REPO = "blackrook-io/taskmesh";

function releaseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: "v0.48.0",
    html_url: "https://github.com/blackrook-io/taskmesh/releases/tag/v0.48.0",
    draft: false,
    prerelease: false,
    ...overrides,
  };
}

describe("parseLatestRelease", () => {
  it("reads a stable release tag and page", () => {
    assert.deepEqual(parseLatestRelease(releaseBody(), REPO), {
      version: "0.48.0",
      htmlUrl: "https://github.com/blackrook-io/taskmesh/releases/tag/v0.48.0",
    });
  });

  it("ignores drafts, prereleases, and pages outside the repo", () => {
    assert.equal(parseLatestRelease(releaseBody({ draft: true }), REPO), null);
    assert.equal(parseLatestRelease(releaseBody({ prerelease: true, tag_name: "v0.1" }), REPO), null);
    assert.equal(
      parseLatestRelease(
        releaseBody({ html_url: "https://github.com/other/taskmesh/releases/tag/v0.48.0" }),
        REPO,
      ),
      null,
    );
    assert.equal(parseLatestRelease(releaseBody({ tag_name: "v0.1-alpha" }), REPO), null);
  });
});

describe("updateAvailable", () => {
  const latest: StableRelease = {
    version: "0.48.0",
    htmlUrl: "https://github.com/blackrook-io/taskmesh/releases/tag/v0.48.0",
  };

  it("is true only when the release is strictly newer", () => {
    assert.equal(updateAvailable("0.47.6", latest), true);
    assert.equal(updateAvailable("0.48.0", latest), false);
    assert.equal(updateAvailable("0.49.0", latest), false);
    assert.equal(updateAvailable("0.47.6", null), false);
  });
});

describe("latestStableRelease", () => {
  beforeEach(() => {
    clearGithubReleaseCache();
  });

  it("treats 404 as no stable release and caches that result", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 404 });
    };
    assert.equal(await latestStableRelease({ now: 1_000, fetchImpl, repo: REPO, token: "" }), null);
    assert.equal(await latestStableRelease({ now: 2_000, fetchImpl, repo: REPO, token: "" }), null);
    assert.equal(calls, 1);
  });

  it("returns a newer release and does not refetch inside the hour", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify(releaseBody()), { status: 200 });
    };
    const first = await latestStableRelease({ now: 10_000, fetchImpl, repo: REPO, token: "" });
    const second = await latestStableRelease({ now: 20_000, fetchImpl, repo: REPO, token: "" });
    assert.equal(first?.version, "0.48.0");
    assert.equal(second?.htmlUrl, first?.htmlUrl);
    assert.equal(calls, 1);
  });

  it("returns null when GitHub fails and retries after the short failure cache", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new Error("offline");
    };
    assert.equal(await latestStableRelease({ now: 0, fetchImpl, repo: REPO, token: "" }), null);
    assert.equal(await latestStableRelease({ now: 60_000, fetchImpl, repo: REPO, token: "" }), null);
    assert.equal(calls, 1);
    assert.equal(
      await latestStableRelease({ now: 5 * 60 * 1000 + 1, fetchImpl, repo: REPO, token: "" }),
      null,
    );
    assert.equal(calls, 2);
  });
});

describe("system update route", () => {
  it("requires an administrator before the handler runs", () => {
    const stack = (systemRouter as unknown as { stack: { handle: unknown }[] }).stack;
    assert.equal(stack[0]?.handle, requireAdministrator);
  });
});
