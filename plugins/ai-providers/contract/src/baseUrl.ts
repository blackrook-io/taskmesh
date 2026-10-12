import { z } from "zod";
import { ProviderConfigError } from "./types.js";

/** Fail closed until the app registers the private-network policy. */
let hostIsBlocked: (host: string) => boolean = () => true;

export function registerProviderHostPolicy(isBlocked: (host: string) => boolean): void {
  hostIsBlocked = isBlocked;
}

/** Sync check for plugin config schemas. DNS pinning is the app's assertBaseUrl. */
export function inspectProviderBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ProviderConfigError("Base URL must be a valid https URL");
  }
  if (url.protocol !== "https:") {
    throw new ProviderConfigError("Base URL must use https");
  }
  if (url.username || url.password) {
    throw new ProviderConfigError("Base URL must not include credentials");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || hostIsBlocked(host)) {
    throw new ProviderConfigError("Base URL must be a public https URL");
  }
  return url;
}

export function normalizeProviderBaseUrl(raw: string): string {
  const url = inspectProviderBaseUrl(raw);
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}${url.search}`;
}

export function publicHttpsBaseUrlSchema() {
  return z
    .string()
    .trim()
    .min(1)
    .superRefine((value, ctx) => {
      try {
        inspectProviderBaseUrl(value);
      } catch (err) {
        ctx.addIssue({
          code: "custom",
          message: err instanceof Error ? err.message : "Invalid base URL",
        });
      }
    });
}
