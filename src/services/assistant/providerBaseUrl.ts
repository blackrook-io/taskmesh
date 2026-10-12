import dns from "node:dns/promises";
import net from "node:net";
import {
  inspectLocalProviderBaseUrl,
  inspectProviderBaseUrl,
  isLinkLocalAddress,
  normalizeLocalProviderBaseUrl,
  normalizeProviderBaseUrl,
  registerProviderHostPolicy,
  ProviderConfigError,
} from "@taskmesh/ai-provider-contract";
import { isBlockedHostname, isBlockedIp, normalizeIpv4Literal } from "../../lib/privateNet.js";

registerProviderHostPolicy((host) => isBlockedHostname(host));

export { ProviderConfigError };

/** Public https only, re-checked against resolved addresses before a request or save. */
export async function assertPublicProviderBaseUrl(raw: string): Promise<string> {
  const url = inspectProviderBaseUrl(raw);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!net.isIP(host)) {
    let records: { address: string }[];
    try {
      records = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
      throw new ProviderConfigError("Could not resolve provider base URL");
    }
    if (records.length === 0 || records.some((record) => isBlockedIp(record.address))) {
      throw new ProviderConfigError("Base URL must be a public https URL");
    }
  }
  return normalizeProviderBaseUrl(raw);
}

/** Local providers may use http and private hosts. Link-local and metadata targets stay blocked. */
export async function assertLocalProviderBaseUrl(raw: string): Promise<string> {
  const url = inspectLocalProviderBaseUrl(raw);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const literal = normalizeIpv4Literal(host);
  if (literal) {
    if (isLinkLocalAddress(literal)) {
      throw new ProviderConfigError("Base URL must not target a link-local or metadata address");
    }
    return normalizeLocalProviderBaseUrl(raw);
  }
  if (net.isIP(host)) {
    if (isLinkLocalAddress(host)) {
      throw new ProviderConfigError("Base URL must not target a link-local or metadata address");
    }
    return normalizeLocalProviderBaseUrl(raw);
  }
  let records: { address: string }[];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ProviderConfigError("Could not resolve provider base URL");
  }
  if (records.length === 0 || records.some((record) => isLinkLocalAddress(record.address))) {
    throw new ProviderConfigError("Base URL must not target a link-local or metadata address");
  }
  return normalizeLocalProviderBaseUrl(raw);
}
