import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeIlikePattern, ilikeContains } from "./ilike.js";
import { sniffImageMime } from "./imageMagic.js";
import { jsonDocumentByteLength, JSON_DOCUMENT_MAX_BYTES } from "./jsonDocument.js";
import { isBlockedHostname, isBlockedIp } from "./privateNet.js";
import { isAllowedHref } from "./safeHref.js";
import { sanitizeMarkdown } from "./sanitizeMarkdown.js";

describe("escapeIlikePattern", () => {
  it("escapes percent, underscore, and backslash", () => {
    assert.equal(escapeIlikePattern("50%_\\x"), "50\\%\\_\\\\x");
    assert.equal(ilikeContains("a"), "%a%");
  });
});

describe("isAllowedHref", () => {
  it("allows http(s), mailto, and same-origin paths", () => {
    assert.equal(isAllowedHref("https://example.com/x"), true);
    assert.equal(isAllowedHref("http://example.com"), true);
    assert.equal(isAllowedHref("mailto:a@b.c"), true);
    assert.equal(isAllowedHref("/api/v1/files/abc.png"), true);
  });

  it("rejects dangerous schemes and protocol-relative URLs", () => {
    assert.equal(isAllowedHref("javascript:alert(1)"), false);
    assert.equal(isAllowedHref("data:text/html,x"), false);
    assert.equal(isAllowedHref("file:///etc/passwd"), false);
    assert.equal(isAllowedHref("//evil.example"), false);
    assert.equal(isAllowedHref("https://user:pass@example.com"), false);
  });
});

describe("sanitizeMarkdown", () => {
  it("strips HTML and rewrites unsafe links", () => {
    const out = sanitizeMarkdown(
      '<script>alert(1)</script>[ok](https://example.com) [bad](javascript:alert(1))\n\n![x](/api/v1/files/a.png)',
    );
    assert.equal(out.includes("<script>"), false);
    assert.equal(out.includes("https://example.com"), true);
    assert.equal(out.includes("javascript:"), false);
    assert.match(out, /!\[x]\(\/api\/v1\/files\/a\.png\)/);
    assert.equal(sanitizeMarkdown("see <https://example.com/a>"), "see <https://example.com/a>");
    assert.equal(sanitizeMarkdown("<script>alert(1)</script>"), "alert(1)");
  });
});

describe("sanitizeIncomingValue", () => {
  it("strips HTML on nested strings but skips passwords", async () => {
    const { sanitizeIncomingValue } = await import("./sanitizeIncoming.js");
    const out = sanitizeIncomingValue({
      name: "<script>alert(1)</script>ok",
      password: "<script>keep</script>",
      nested: { body: "<script>x</script>see <https://example.com>" },
    }) as {
      name: string;
      password: string;
      nested: { body: string };
    };
    assert.equal(out.name, "alert(1)ok");
    assert.equal(out.password, "<script>keep</script>");
    assert.equal(out.nested.body.includes("<script>"), false);
    assert.equal(out.nested.body.includes("https://example.com"), true);
  });
});

describe("sanitizePlainText", () => {
  it("strips tags from titles", async () => {
    const { sanitizePlainText } = await import("./plainText.js");
    assert.equal(sanitizePlainText("<script>alert(1)</script>"), "alert(1)");
    assert.equal(sanitizePlainText("Hello <b>World</b>"), "Hello World");
  });
});

describe("sniffImageMime", () => {
  it("detects jpeg/png/gif/webp signatures", () => {
    assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
    assert.equal(
      sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      "image/png",
    );
    assert.equal(sniffImageMime(Buffer.from("GIF89a....")), "image/gif");
    const webp = Buffer.alloc(12);
    webp.write("RIFF", 0);
    webp.write("WEBP", 8);
    assert.equal(sniffImageMime(webp), "image/webp");
    assert.equal(sniffImageMime(Buffer.from("<html>")), null);
  });
});

describe("privateNet", () => {
  it("blocks loopback, RFC1918, link-local, and metadata", () => {
    assert.equal(isBlockedIp("127.0.0.1"), true);
    assert.equal(isBlockedIp("10.1.2.3"), true);
    assert.equal(isBlockedIp("192.168.0.1"), true);
    assert.equal(isBlockedIp("172.16.0.1"), true);
    assert.equal(isBlockedIp("169.254.169.254"), true);
    assert.equal(isBlockedIp("8.8.8.8"), false);
    assert.equal(isBlockedIp("::1"), true);
    assert.equal(isBlockedIp("::ffff:127.0.0.1"), true);
    assert.equal(isBlockedHostname("localhost"), true);
    assert.equal(isBlockedHostname("foo.local"), true);
    assert.equal(isBlockedHostname("example.com"), false);
  });
});

describe("jsonDocumentByteLength", () => {
  it("counts UTF-8 bytes", () => {
    assert.ok(jsonDocumentByteLength({ a: 1 }) < JSON_DOCUMENT_MAX_BYTES);
  });
});
