import net from "node:net";
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

const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata.goog"]);

const LOCAL_URL_ERROR = "Base URL must not target a link-local or metadata address";

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    n = (n << 8) + octet;
  }
  return n >>> 0;
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const left = ipv4ToInt(ip);
  const right = ipv4ToInt(base);
  if (left == null || right == null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (left & mask) === (right & mask);
}

/** Link-local IPv4 (169.254.0.0/16) and IPv6 (fe80::/10), including IPv4-mapped forms. */
export function isLinkLocalAddress(ip: string): boolean {
  const bare = ip.trim().toLowerCase().split("%")[0] ?? "";
  if (!bare) return false;
  const mapped = bare.startsWith("::ffff:") ? bare.slice("::ffff:".length) : bare;
  if (net.isIP(mapped) === 4) return inCidr(mapped, "169.254.0.0", 16);
  const v6 = net.isIP(bare) === 6 ? bare : net.isIP(mapped) === 6 ? mapped : "";
  if (!v6) return false;
  const first = v6.split(":")[0] ?? "";
  const head = Number.parseInt(first.padEnd(4, "0").slice(0, 4), 16);
  if (Number.isNaN(head)) return false;
  return (head & 0xffc0) === 0xfe80;
}

function hostIsMetadata(host: string): boolean {
  return METADATA_HOSTS.has(host) || isLinkLocalAddress(host);
}

/** http(s) base URL for a local provider. Private and loopback hosts are allowed. */
export function inspectLocalProviderBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ProviderConfigError("Base URL must be a valid http or https URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProviderConfigError("Base URL must use http or https");
  }
  if (url.username || url.password) {
    throw new ProviderConfigError("Base URL must not include credentials");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || hostIsMetadata(host)) {
    throw new ProviderConfigError(LOCAL_URL_ERROR);
  }
  return url;
}

export function normalizeLocalProviderBaseUrl(raw: string): string {
  const url = inspectLocalProviderBaseUrl(raw);
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}${url.search}`;
}

export function localProviderBaseUrlSchema() {
  return z
    .string()
    .trim()
    .min(1)
    .superRefine((value, ctx) => {
      try {
        inspectLocalProviderBaseUrl(value);
      } catch (err) {
        ctx.addIssue({
          code: "custom",
          message: err instanceof Error ? err.message : "Invalid base URL",
        });
      }
    });
}
