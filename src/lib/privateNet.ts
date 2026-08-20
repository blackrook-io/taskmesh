import net from "node:net";

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) + o;
  }
  return n >>> 0;
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a == null || b == null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

function mappedIpv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const prefix = "::ffff:";
  if (!lower.startsWith(prefix)) return null;
  const rest = lower.slice(prefix.length);
  return net.isIP(rest) === 4 ? rest : null;
}

/** True when the address must not be fetched by the assistant. */
export function isBlockedIp(ip: string): boolean {
  const v4mapped = mappedIpv4(ip);
  if (v4mapped) return isBlockedIp(v4mapped);

  if (net.isIP(ip) === 4) {
    if (inCidr(ip, "0.0.0.0", 8)) return true;
    if (inCidr(ip, "10.0.0.0", 8)) return true;
    if (inCidr(ip, "127.0.0.0", 8)) return true;
    if (inCidr(ip, "169.254.0.0", 16)) return true;
    if (inCidr(ip, "172.16.0.0", 12)) return true;
    if (inCidr(ip, "192.168.0.0", 16)) return true;
    if (inCidr(ip, "224.0.0.0", 4)) return true;
    return false;
  }

  if (net.isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fe80:")) return true;
    const first = lower.split(":")[0] ?? "";
    const n = Number.parseInt(first.padEnd(4, "0").slice(0, 4), 16);
    if (!Number.isNaN(n) && (n & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((n & 0xff00) === 0xff00) return true; // multicast
    return false;
  }

  return true;
}

export function isBlockedHostname(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h === "0.0.0.0" || h === "::1") return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return true;
  if (h === "169.254.169.254" || h === "metadata.google.internal") return true;
  if (net.isIP(h) && isBlockedIp(h)) return true;
  return false;
}
