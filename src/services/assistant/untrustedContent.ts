import type { AiAction } from "./aiPolicy.js";

const FENCE_OPEN = /^<<<untrusted source="[a-z0-9_:-]+">>>\n/;
const FENCE_CLOSE = "\n<<<end>>>";

/** Writes and external fetches that are flagged after private text was already in the turn. */
const FOLLOWUP_ACTIONS = new Set<AiAction>([
  "propose_create",
  "propose_update",
  "link",
  "tag",
  "comment",
  "apply",
  "propose_delete",
  "bulk",
  "web_fetch",
]);

const CONTROL_TOKENS = [
  String.raw`<\|im_start\|>`,
  String.raw`<\|im_end\|>`,
  String.raw`<\|system\|>`,
  String.raw`<\|user\|>`,
  String.raw`<\|assistant\|>`,
  String.raw`<\|tool\|>`,
  String.raw`\[INST\]`,
  String.raw`\[/INST\]`,
  String.raw`<<SYS>>`,
  String.raw`<</SYS>>`,
];

/** Replace chat-template tokens and role tags. Ordinary Markdown is left in place. */
export function neutralizeUntrusted(text: string): string {
  let out = text;
  for (const source of CONTROL_TOKENS) {
    out = out.replace(new RegExp(source, "gi"), "[neutralized]");
  }
  return out.replace(/<\/?\s*(?:system|tool|assistant)\b[^>]*>/gi, "[neutralized]");
}

export function toolUntrustedSource(name: string): string {
  const source = `tool:${name}`;
  return /^[a-z0-9_:-]+$/.test(source) ? source : "tool:unknown";
}

/**
 * Fence record, page, or file text so the model is told it is data.
 * A payload that contains `<<<` cannot close the fence.
 * Already-fenced text is returned unchanged.
 */
export function wrapUntrusted(text: string, source: string): string {
  if (FENCE_OPEN.test(text) && text.endsWith(FENCE_CLOSE)) return text;
  const safeSource = /^[a-z0-9_:-]+$/.test(source) ? source : "unknown";
  const body = neutralizeUntrusted(text).replaceAll("<<<", "‹‹‹");
  return `<<<untrusted source="${safeSource}">>>\n${body}\n<<<end>>>`;
}

/** Inner text of one fence. Returns `text` when it is not fenced. */
export function unwrapUntrusted(text: string): string {
  const match = text.match(/^<<<untrusted source="[a-z0-9_:-]+">>>\n([\s\S]*)\n<<<end>>>$/);
  return match?.[1] ?? text;
}

/** Page context, file text, or a read-tool result. A prior web fetch does not count. */
export function containsPrivateUntrusted(text: string): boolean {
  return /<<<untrusted source="(?:page|file|tool:(?!fetch_url")[a-z0-9_:-]+)">>>/.test(text);
}

/** Append the audit flag when a write or fetch follows private text. */
export function withUntrustedFollowup(action: AiAction, reason: string, active: boolean): string {
  if (!active || !FOLLOWUP_ACTIONS.has(action)) return reason;
  if (reason.includes("untrusted-followup")) return reason;
  return `${reason} | untrusted-followup`;
}
