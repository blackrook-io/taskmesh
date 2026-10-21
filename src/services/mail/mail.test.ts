import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mailTransportOptions, redactMailError } from "./outbound.js";
import {
  isEmailSignupOpen,
  isMailHost,
  mailPatchSchema,
  secretHint,
  smtpPassword,
  toMailPublic,
  type MailRuntime,
} from "./settings.js";

const runtime: MailRuntime = {
  enabled: true,
  host: "smtp.example.com",
  port: 587,
  encryption: "starttls",
  username: "apikey",
  password: null,
  apiToken: "token-secret-value",
  fromAddress: "noreply@example.com",
  fromName: "TaskMesh",
  replyTo: "reply@example.com",
  timeoutSeconds: 15,
};

describe("mail settings", () => {
  it("accepts a hostname and rejects a URL", () => {
    assert.equal(isMailHost("smtp.example.com"), true);
    assert.equal(isMailHost("10.0.0.8"), true);
    assert.equal(isMailHost("[2001:db8::1]"), true);
    assert.equal(isMailHost("https://smtp.example.com"), false);
    assert.equal(isMailHost("user@host"), false);
  });

  it("keeps a short secret out of the hint", () => {
    assert.equal(secretHint("abcd"), null);
    assert.equal(secretHint("abcde"), "bcde");
  });

  it("uses the API token as the SMTP password when the password is blank", () => {
    assert.equal(smtpPassword(runtime), "token-secret-value");
    assert.equal(smtpPassword({ ...runtime, password: "pw-secret" }), "pw-secret");
  });

  it("maps encryption to SMTP transport flags", () => {
    const starttls = mailTransportOptions(runtime);
    assert.equal(starttls.secure, false);
    assert.equal(starttls.requireTLS, true);
    assert.equal(starttls.ignoreTLS, false);
    assert.equal(starttls.auth?.pass, "token-secret-value");
    assert.equal(starttls.connectionTimeout, 15_000);

    const tls = mailTransportOptions({ ...runtime, encryption: "tls", port: 465 });
    assert.equal(tls.secure, true);
    assert.equal(tls.requireTLS, false);

    const open = mailTransportOptions({
      ...runtime,
      encryption: "none",
      username: "",
      password: null,
      apiToken: null,
    });
    assert.equal(open.ignoreTLS, true);
    assert.equal(open.auth, undefined);
  });

  it("does not return stored secrets", () => {
    const row = {
      id: 1,
      enabled: false,
      selfSignupEnabled: false,
      host: "smtp.example.com",
      port: 587,
      encryption: "starttls",
      username: "mailer",
      passwordEnc: "ciphertext-not-the-password",
      passwordHint: "word",
      apiTokenEnc: null,
      apiTokenHint: null,
      fromAddress: "noreply@example.com",
      fromName: "TaskMesh",
      replyTo: "",
      timeoutSeconds: 30,
      updatedById: null,
      updatedAt: new Date("2026-10-21T12:00:00.000Z"),
    };
    const pub = toMailPublic(row, true);
    assert.equal(pub.passwordSet, true);
    assert.equal(pub.passwordHint, "word");
    assert.equal(pub.apiTokenSet, false);
    assert.equal("passwordEnc" in pub, false);
    assert.equal(JSON.stringify(pub).includes("ciphertext"), false);
  });

  it("rejects an enabled config without a From address", () => {
    const parsed = mailPatchSchema.safeParse({
      enabled: true,
      selfSignupEnabled: false,
      host: "smtp.example.com",
      port: 587,
      encryption: "starttls",
      username: "",
      fromAddress: "",
      fromName: "TaskMesh",
      replyTo: "",
      timeoutSeconds: 30,
    });
    assert.equal(parsed.success, false);
  });

  it("allows self-signup only when outbound mail can send", () => {
    assert.equal(
      isEmailSignupOpen({
        enabled: true,
        selfSignupEnabled: true,
        host: "smtp.example.com",
        fromAddress: "noreply@example.com",
      }),
      true,
    );
    assert.equal(
      isEmailSignupOpen({
        enabled: false,
        selfSignupEnabled: true,
        host: "smtp.example.com",
        fromAddress: "noreply@example.com",
      }),
      false,
    );
    assert.equal(
      isEmailSignupOpen({
        enabled: true,
        selfSignupEnabled: false,
        host: "smtp.example.com",
        fromAddress: "noreply@example.com",
      }),
      false,
    );
  });

  it("redacts a secret that leaked into a server error", () => {
    const message = redactMailError(new Error("auth failed for token-secret-value"), [
      "token-secret-value",
    ]);
    assert.equal(message.includes("token-secret-value"), false);
    assert.match(message, /\[redacted\]/);
  });
});
