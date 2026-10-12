import dns from "node:dns/promises";
import net from "node:net";
import {
  inspectProviderBaseUrl,
  normalizeProviderBaseUrl,
  registerProviderHostPolicy,
  ProviderConfigError,
} from "@taskmesh/ai-provider-contract";
import { isBlockedHostname, isBlockedIp } from "../../lib/privateNet.js";

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
