import { SignJWT, importPKCS8 } from "jose";
import * as client from "openid-client";
import type { OauthProviderRow } from "./providers.js";
import { decryptProviderSecret } from "./providers.js";

export type NormalizedIdentity = {
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  raw: Record<string, unknown>;
};

function serviceErr(message: string, status: number, code: string): Error {
  return Object.assign(new Error(message), { status, code });
}

const GOOGLE_ISSUER = "https://accounts.google.com";
const APPLE_ISSUER = "https://appleid.apple.com";
const GITHUB_AUTH = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_USER = "https://api.github.com/user";
const GITHUB_EMAILS = "https://api.github.com/user/emails";

export function defaultScopes(slug: string): string {
  if (slug === "github") return "read:user user:email";
  if (slug === "apple") return "name email";
  return "openid email profile";
}

export async function buildAppleClientSecret(provider: OauthProviderRow): Promise<string> {
  const teamId = provider.appleTeamId?.trim();
  const keyId = provider.appleKeyId?.trim();
  const clientId = provider.clientId?.trim();
  const pkEnc = provider.applePrivateKeyEnc;
  if (!teamId || !keyId || !clientId || !pkEnc) {
    throw serviceErr(
      "Apple provider is missing Team ID, Key ID, Services ID, or private key.",
      400,
      "oauth_misconfigured",
    );
  }
  const pkPem = decryptProviderSecret(pkEnc);
  if (!pkPem) {
    throw serviceErr("Apple private key is not configured.", 400, "oauth_misconfigured");
  }
  const key = await importPKCS8(pkPem, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setSubject(clientId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 50)
    .sign(key);
}

async function googleConfig(provider: OauthProviderRow): Promise<client.Configuration> {
  const clientId = provider.clientId?.trim();
  const secret = decryptProviderSecret(provider.clientSecretEnc);
  if (!clientId || !secret) {
    throw serviceErr("Google provider is missing client id or secret.", 400, "oauth_misconfigured");
  }
  return client.discovery(
    new URL(GOOGLE_ISSUER),
    clientId,
    undefined,
    client.ClientSecretPost(secret),
  );
}

async function appleConfig(provider: OauthProviderRow): Promise<client.Configuration> {
  const clientId = provider.clientId?.trim();
  if (!clientId) {
    throw serviceErr("Apple provider is missing Services ID (client id).", 400, "oauth_misconfigured");
  }
  const secret = await buildAppleClientSecret(provider);
  return client.discovery(
    new URL(APPLE_ISSUER),
    clientId,
    undefined,
    client.ClientSecretPost(secret),
  );
}

export async function buildAuthorizationUrl(opts: {
  provider: OauthProviderRow;
  redirectUri: string;
  state: string;
  codeVerifier: string;
  nonce: string | null;
}): Promise<URL> {
  const { provider, redirectUri, state, codeVerifier, nonce } = opts;
  const scopes = (provider.scopes?.trim() || defaultScopes(provider.slug))
    .split(/\s+/)
    .filter(Boolean);
  const challenge = await client.calculatePKCECodeChallenge(codeVerifier);

  if (provider.slug === "github") {
    const clientId = provider.clientId?.trim();
    if (!clientId) {
      throw serviceErr("GitHub provider is missing client id.", 400, "oauth_misconfigured");
    }
    const url = new URL(GITHUB_AUTH);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url;
  }

  const config =
    provider.slug === "apple" ? await appleConfig(provider) : await googleConfig(provider);

  return client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(nonce ? { nonce } : {}),
    ...(provider.slug === "apple" ? { response_mode: "form_post" } : {}),
  });
}

export async function exchangeCodeForIdentity(opts: {
  provider: OauthProviderRow;
  redirectUri: string;
  code: string;
  state: string;
  codeVerifier: string;
  nonce: string | null;
  appleUserJson?: string | null;
}): Promise<NormalizedIdentity> {
  const { provider, redirectUri, code, state, codeVerifier, nonce, appleUserJson } = opts;

  if (provider.slug === "github") {
    return exchangeGithub(provider, redirectUri, code, codeVerifier);
  }

  const config =
    provider.slug === "apple" ? await appleConfig(provider) : await googleConfig(provider);

  const currentUrl = new URL(redirectUri);
  currentUrl.searchParams.set("code", code);
  currentUrl.searchParams.set("state", state);

  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
    expectedNonce: nonce ?? undefined,
    idTokenExpected: true,
  });

  const claims = tokens.claims();
  if (!claims?.sub) {
    throw serviceErr("Identity provider did not return a subject.", 400, "oauth_failed");
  }

  let email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const emailVerified =
    claims.email_verified === true ||
    claims.email_verified === "true" ||
    provider.slug === "apple";

  let displayName: string | null =
    typeof claims.name === "string"
      ? claims.name
      : typeof claims.preferred_username === "string"
        ? claims.preferred_username
        : null;

  if (provider.slug === "apple" && appleUserJson) {
    try {
      const parsed = JSON.parse(appleUserJson) as {
        name?: { firstName?: string; lastName?: string };
        email?: string;
      };
      if (!email && typeof parsed.email === "string") {
        email = parsed.email.trim().toLowerCase();
      }
      const parts = [parsed.name?.firstName, parsed.name?.lastName].filter(Boolean);
      if (parts.length) displayName = parts.join(" ");
    } catch {
      /* ignore malformed Apple user payload */
    }
  }

  if (!email) {
    throw serviceErr("Identity provider did not return an email address.", 400, "oauth_failed");
  }
  if (!emailVerified) {
    throw serviceErr("Identity provider email is not verified.", 400, "oauth_failed");
  }

  return {
    subject: String(claims.sub),
    email,
    emailVerified,
    displayName,
    raw: { ...claims } as Record<string, unknown>,
  };
}

async function exchangeGithub(
  provider: OauthProviderRow,
  redirectUri: string,
  code: string,
  codeVerifier: string,
): Promise<NormalizedIdentity> {
  const clientId = provider.clientId?.trim();
  const secret = decryptProviderSecret(provider.clientSecretEnc);
  if (!clientId || !secret) {
    throw serviceErr("GitHub provider is missing client id or secret.", 400, "oauth_misconfigured");
  }

  const tokenRes = await fetch(GITHUB_TOKEN, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: secret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  if (!tokenRes.ok) {
    throw serviceErr("GitHub token exchange failed.", 400, "oauth_failed");
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenJson.access_token) {
    throw serviceErr(tokenJson.error || "GitHub token exchange failed.", 400, "oauth_failed");
  }

  const userRes = await fetch(GITHUB_USER, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokenJson.access_token}`,
      "User-Agent": "TaskMesh",
    },
  });
  if (!userRes.ok) {
    throw serviceErr("GitHub user profile fetch failed.", 400, "oauth_failed");
  }
  const user = (await userRes.json()) as {
    id: number;
    login?: string;
    name?: string | null;
    email?: string | null;
  };

  const emailsRes = await fetch(GITHUB_EMAILS, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokenJson.access_token}`,
      "User-Agent": "TaskMesh",
    },
  });
  let email = "";
  let emailVerified = false;
  if (emailsRes.ok) {
    const emails = (await emailsRes.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
    const primary =
      emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (primary) {
      email = primary.email.trim().toLowerCase();
      emailVerified = primary.verified;
    }
  }
  if (!email && user.email) {
    email = user.email.trim().toLowerCase();
    emailVerified = false;
  }
  if (!email || !emailVerified) {
    throw serviceErr(
      "GitHub did not provide a verified email address.",
      400,
      "oauth_failed",
    );
  }

  return {
    subject: String(user.id),
    email,
    emailVerified,
    displayName: user.name?.trim() || user.login || null,
    raw: { id: user.id, login: user.login, name: user.name },
  };
}
