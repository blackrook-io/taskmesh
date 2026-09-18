import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { decodeJwt } from "jose";
import { encryptOauthSecret } from "../../lib/oauthCrypto.js";
import { buildAppleClientSecret } from "./adapters.js";
import type { OauthProviderRow } from "./providers.js";

describe("buildAppleClientSecret", () => {
  it("signs an ES256 client-secret JWT", async () => {
    const prev = process.env.OAUTH_CREDENTIALS_KEY;
    process.env.OAUTH_CREDENTIALS_KEY = "apple-jwt-unit-test-key";
    try {
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const provider = {
        id: 1,
        slug: "apple",
        name: "Apple",
        protocol: "oidc",
        enabled: true,
        clientId: "com.example.taskmesh",
        clientSecretEnc: null,
        appleTeamId: "TEAMID123",
        appleKeyId: "KEYID1234",
        applePrivateKeyEnc: encryptOauthSecret(pem),
        scopes: "name email",
        jitEnabled: false,
        defaultRoleId: null,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies OauthProviderRow;

      const jwt = await buildAppleClientSecret(provider);
      const claims = decodeJwt(jwt);
      assert.equal(claims.iss, "TEAMID123");
      assert.equal(claims.sub, "com.example.taskmesh");
      assert.equal(claims.aud, "https://appleid.apple.com");
    } finally {
      if (prev === undefined) delete process.env.OAUTH_CREDENTIALS_KEY;
      else process.env.OAUTH_CREDENTIALS_KEY = prev;
    }
  });
});
