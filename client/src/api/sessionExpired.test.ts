import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApiRequestError, retryUnlessUnauthorized } from "./client.ts";
import {
  beginExplicitLogout,
  isForcedLoggedOut,
  isLoginCredentialRequest,
  markSessionActive,
  peekSessionExpiredReason,
  redirectForSessionLoss,
  resetSessionExpiredGuard,
  sessionLossLoginUrl,
  setSessionExpiredHandler,
  type SessionLossLocation,
} from "./sessionExpired.ts";

const projects: SessionLossLocation = { pathname: "/projects/4", search: "?tab=tasks", hash: "#notes" };
const home: SessionLossLocation = { pathname: "/", search: "", hash: "" };
const login: SessionLossLocation = { pathname: "/login", search: "", hash: "" };

afterEach(() => {
  markSessionActive();
  setSessionExpiredHandler(null);
});

describe("sessionLossLoginUrl", () => {
  it("keeps the current page and marks the session as ended", () => {
    const url = sessionLossLoginUrl(projects);
    const params = new URL(url, "http://taskmesh.local").searchParams;
    assert.equal(params.get("returnTo"), "/projects/4?tab=tasks#notes");
    assert.equal(params.get("reason"), "session");
  });

  it("omits returnTo on the home page", () => {
    assert.equal(sessionLossLoginUrl(home), "/login?reason=session");
  });
});

describe("redirectForSessionLoss", () => {
  it("forces logged out and ignores a second 401 until the guard resets", () => {
    let cleared = 0;
    setSessionExpiredHandler(() => {
      cleared += 1;
    });
    const url = redirectForSessionLoss(projects);
    assert.equal(url, sessionLossLoginUrl(projects));
    assert.equal(isForcedLoggedOut(), true);
    assert.equal(peekSessionExpiredReason(), true);
    assert.equal(cleared, 1);
    assert.equal(redirectForSessionLoss(home), null);

    resetSessionExpiredGuard();
    assert.equal(isForcedLoggedOut(), true);
    assert.equal(redirectForSessionLoss(home), "/login?reason=session");
  });

  it("does not latch while already on the login page", () => {
    assert.equal(redirectForSessionLoss(login), null);
    assert.equal(isForcedLoggedOut(), false);
    assert.ok(redirectForSessionLoss(projects));
  });

  it("does not treat an explicit logout as session expiry", () => {
    beginExplicitLogout();
    assert.equal(redirectForSessionLoss(projects), null);
    assert.equal(isForcedLoggedOut(), false);
    assert.equal(peekSessionExpiredReason(), false);
    resetSessionExpiredGuard();
    assert.equal(redirectForSessionLoss(home), null);
    markSessionActive();
    assert.equal(redirectForSessionLoss(home), "/login?reason=session");
  });

  it("still redirects when the auth-clear handler throws", () => {
    setSessionExpiredHandler(() => {
      throw new Error("clear failed");
    });
    assert.equal(redirectForSessionLoss(projects), sessionLossLoginUrl(projects));
    assert.equal(isForcedLoggedOut(), true);
  });
});

describe("isLoginCredentialRequest", () => {
  it("skips password and MFA failures", () => {
    assert.equal(isLoginCredentialRequest("/api/v1/auth/login"), true);
    assert.equal(isLoginCredentialRequest("/api/v1/auth/mfa/verify?x=1"), true);
    assert.equal(isLoginCredentialRequest("/api/v1/projects"), false);
  });
});

describe("retryUnlessUnauthorized", () => {
  it("does not retry a 401 and otherwise keeps three attempts", () => {
    const denied = new ApiRequestError("Authentication required.", 401, { code: "not_authenticated" });
    assert.equal(retryUnlessUnauthorized(0, denied), false);
    assert.equal(retryUnlessUnauthorized(0, new Error("nope")), true);
    assert.equal(retryUnlessUnauthorized(2, new Error("nope")), true);
    assert.equal(retryUnlessUnauthorized(3, new Error("nope")), false);
  });
});
