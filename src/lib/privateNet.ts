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

function intToDottedQuad(n: number): string {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

/** Parse a single IPv4 octet that may be decimal, octal (leading 0), or hex (0x). */
function parseIpv4Part(part: string): number | null {
  const p = part.trim().toLowerCase();
  if (!p) return null;
  let n: number;
  if (/^0x[0-9a-f]+$/.test(p)) {
    n = Number.parseInt(p.slice(2), 16);
  } else if (/^0[0-7]+$/.test(p)) {
    n = Number.parseInt(p, 8);
  } else if (/^\d+$/.test(p)) {
    n = Number.parseInt(p, 10);
  } else {
    return null;
  }
  if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  return n;
}

/**
 * Normalize unusual IPv4 literals (decimal, hex, octal, shorthand dotted) to
 * canonical dotted-decimal. Returns null when the input is not an IPv4 literal.
 */
export function normalizeIpv4Literal(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!s) return null;
  if (net.isIP(s) === 4) return s;

  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) return null;
    return intToDottedQuad(n >>> 0);
  }
  if (/^0x[0-9a-f]+$/.test(s)) {
    const n = Number.parseInt(s.slice(2), 16);
    if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) return null;
    return intToDottedQuad(n >>> 0);
  }
  if (/^0[0-7]+$/.test(s)) {
    const n = Number.parseInt(s, 8);
    if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) return null;
    return intToDottedQuad(n >>> 0);
  }

  const parts = s.split(".");
  if (parts.length < 2 || parts.length > 4) return null;

  const nums: number[] = [];
  for (const part of parts) {
    // Last component of a shorthand form may exceed 255 (e.g. 127.1 → 127.0.0.1
    // with last part as remaining 24 bits is uncommon; browsers use 127.0.0.1 for 127.1).
    const parsed = parseIpv4Part(part);
    if (parsed == null) {
      // Allow a final oversized decimal only for classic 2/3-part shorthand.
      if (parts.length < 4 && part === parts[parts.length - 1] && /^\d+$/.test(part)) {
        const wide = Number.parseInt(part, 10);
        if (!Number.isInteger(wide) || wide < 0) return null;
        nums.push(wide);
        continue;
      }
      return null;
    }
    nums.push(parsed);
  }

  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  if (nums.length === 4) {
    [a, b, c, d] = nums as [number, number, number, number];
  } else if (nums.length === 3) {
    // a.b.c → a.b.(c>>8).(c&255) when c > 255, else a.b.0.c
    a = nums[0]!;
    b = nums[1]!;
    const rest = nums[2]!;
    if (rest > 0xffff) return null;
    if (rest > 255) {
      c = (rest >>> 8) & 255;
      d = rest & 255;
    } else {
      c = 0;
      d = rest;
    }
  } else if (nums.length === 2) {
    // a.b → a.(b>>16).((b>>8)&255).(b&255) or a.0.0.b
    a = nums[0]!;
    const rest = nums[1]!;
    if (rest > 0xff_ffff) return null;
    if (rest > 255) {
      b = (rest >>> 16) & 255;
      c = (rest >>> 8) & 255;
      d = rest & 255;
    } else {
      b = 0;
      c = 0;
      d = rest;
    }
  } else {
    return null;
  }

  if ([a, b, c, d].some((o) => o < 0 || o > 255)) return null;
  return `${a}.${b}.${c}.${d}`;
}

/** True when the address must not be fetched by the assistant. */
export function isBlockedIp(ip: string): boolean {
  const normalized = normalizeIpv4Literal(ip) ?? ip;
  const v4mapped = mappedIpv4(normalized);
  if (v4mapped) return isBlockedIp(v4mapped);

  if (net.isIP(normalized) === 4) {
    if (inCidr(normalized, "0.0.0.0", 8)) return true;
    if (inCidr(normalized, "10.0.0.0", 8)) return true;
    if (inCidr(normalized, "100.64.0.0", 10)) return true;
    if (inCidr(normalized, "127.0.0.0", 8)) return true;
    if (inCidr(normalized, "169.254.0.0", 16)) return true;
    if (inCidr(normalized, "172.16.0.0", 12)) return true;
    if (inCidr(normalized, "192.168.0.0", 16)) return true;
    if (inCidr(normalized, "224.0.0.0", 4)) return true;
    return false;
  }

  if (net.isIP(normalized) === 6) {
    const lower = normalized.toLowerCase();
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
  const asIpv4 = normalizeIpv4Literal(h);
  if (asIpv4 && isBlockedIp(asIpv4)) return true;
  if (net.isIP(h) && isBlockedIp(h)) return true;
  return false;
}
