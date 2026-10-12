import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROMPT_ID = /^[a-z0-9_]+$/;
const PROVIDER_ID = /^[a-z0-9-]+$/;
const VERSION_FILE = /^v([1-9][0-9]*)\.md$/;

export class PromptRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptRegistryError";
  }
}

export type LoadedPrompt = {
  id: string;
  version: number;
  /** Set when a provider file replaced the default. */
  providerId: string | null;
  body: string;
  /** `id@version` or `id@version/provider`. */
  ref: string;
};

export type ComposedPrompt = {
  text: string;
  promptId: string;
  promptVersion: number;
  promptRef: string;
};

/**
 * Repo path of the prompt files. Resolved from this module so both `tsx` (src)
 * and production (`dist`) read `src/services/assistant/prompts`.
 */
export function promptsRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../src/services/assistant/prompts");
}

/** Highest `vN.md` for `id`, using `prompts/<id>/<providerId>/` when that directory has a file. */
export function loadPrompt(args: {
  id: string;
  providerId?: string | null;
  root?: string;
}): LoadedPrompt {
  if (!PROMPT_ID.test(args.id)) throw new PromptRegistryError(`Unknown prompt id: ${args.id}`);
  const providerId = args.providerId?.trim() || null;
  if (providerId && !PROVIDER_ID.test(providerId)) {
    throw new PromptRegistryError(`Unknown prompt provider: ${providerId}`);
  }
  const rootReal = realRoot(args.root ?? promptsRoot());
  const idDir = path.join(rootReal, args.id);
  let chosen: { version: number; body: string } | null = null;
  let usedProvider: string | null = null;
  if (providerId) {
    const variant = readHighest(path.join(idDir, providerId), rootReal);
    if (variant) {
      chosen = variant;
      usedProvider = providerId;
    }
  }
  if (!chosen) chosen = readHighest(idDir, rootReal);
  if (!chosen) throw new PromptRegistryError(`Prompt not found: ${args.id}`);
  const ref = usedProvider ? `${args.id}@${chosen.version}/${usedProvider}` : `${args.id}@${chosen.version}`;
  return { id: args.id, version: chosen.version, providerId: usedProvider, body: chosen.body, ref };
}

/** Assistant system text from versioned files. Policy text is appended by the caller. */
export function composeAssistantPrompt(args: {
  webFetchEnabled: boolean;
  providerId?: string | null;
  root?: string;
}): ComposedPrompt {
  const base = loadPrompt({ id: "assistant", providerId: args.providerId, root: args.root });
  if (!args.webFetchEnabled) {
    return {
      text: base.body,
      promptId: base.id,
      promptVersion: base.version,
      promptRef: base.ref,
    };
  }
  const fetchPart = loadPrompt({ id: "assistant_web_fetch", providerId: args.providerId, root: args.root });
  return {
    text: `${base.body}\n${fetchPart.body}`,
    promptId: base.id,
    promptVersion: base.version,
    promptRef: `${base.ref}+${fetchPart.ref}`,
  };
}

function realRoot(root: string): string {
  try {
    return fs.realpathSync(path.resolve(root));
  } catch {
    throw new PromptRegistryError("Prompt registry is missing");
  }
}

function readHighest(dir: string, rootReal: string): { version: number; body: string } | null {
  if (!fs.existsSync(dir)) return null;
  const dirReal = assertInside(dir, rootReal);
  let best: { version: number; body: string } | null = null;
  for (const name of fs.readdirSync(dirReal)) {
    const match = VERSION_FILE.exec(name);
    if (!match) continue;
    const version = Number(match[1]);
    const fileReal = assertInside(path.join(dirReal, name), rootReal);
    const body = fs.readFileSync(fileReal, "utf8").trim();
    if (!body) throw new PromptRegistryError(`Prompt file is empty: ${name}`);
    if (!best || version > best.version) best = { version, body };
  }
  return best;
}

function assertInside(target: string, rootReal: string): string {
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch {
    throw new PromptRegistryError("Prompt path is missing");
  }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new PromptRegistryError("Prompt path escapes the registry");
  }
  return real;
}
