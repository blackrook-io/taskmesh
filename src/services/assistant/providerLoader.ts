import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AiProviderPlugin } from "@taskmesh/ai-provider-contract";

const PLUGIN_ID = /^[a-z0-9-]+$/;

type PackageMeta = {
  name?: string;
  taskmesh?: { role?: string };
};

let registry: Map<string, AiProviderPlugin> | null = null;

export function aiProvidersRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../plugins/ai-providers");
}

export function loadedAiProviders(): AiProviderPlugin[] {
  return [...(registry?.values() ?? [])];
}

export function getAiProvider(id: string): AiProviderPlugin | null {
  return registry?.get(id) ?? null;
}

/** Load provider packages from the allowlisted directory. Safe to call again. */
export async function loadAiProviderPlugins(rootDir = aiProvidersRoot()): Promise<AiProviderPlugin[]> {
  const next = new Map<string, AiProviderPlugin>();
  let rootReal: string;
  try {
    rootReal = await fs.realpath(rootDir);
  } catch (err) {
    console.warn("AI provider directory is missing", err instanceof Error ? err.message : err);
    registry = next;
    return [];
  }
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (!PLUGIN_ID.test(entry.name)) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const dir = path.join(rootDir, entry.name);
    let dirReal: string;
    try {
      dirReal = await fs.realpath(dir);
    } catch {
      continue;
    }
    if (dirReal !== rootReal && !dirReal.startsWith(rootReal + path.sep)) {
      console.warn(`Skipping AI provider outside the allowlist: ${entry.name}`);
      continue;
    }
    const loaded = await loadOne(entry.name, dirReal);
    if (!loaded) continue;
    if (next.has(loaded.id)) {
      console.warn(`Skipping duplicate AI provider id: ${loaded.id}`);
      continue;
    }
    next.set(loaded.id, loaded);
  }
  registry = next;
  return [...next.values()];
}

async function loadOne(dirName: string, dirReal: string): Promise<AiProviderPlugin | null> {
  let meta: PackageMeta;
  try {
    const raw = await fs.readFile(path.join(dirReal, "package.json"), "utf8");
    meta = JSON.parse(raw) as PackageMeta;
  } catch {
    return null;
  }
  if (meta.taskmesh?.role !== "provider") return null;
  if (meta.name !== `@taskmesh/ai-provider-${dirName}`) {
    console.warn(`Skipping AI provider ${dirName}: package name does not match the directory`);
    return null;
  }
  const entryPath = path.join(dirReal, "dist", "index.js");
  let entryReal: string;
  try {
    entryReal = await fs.realpath(entryPath);
  } catch {
    console.warn(`Skipping AI provider ${dirName}: dist/index.js is missing`);
    return null;
  }
  if (!entryReal.startsWith(dirReal + path.sep)) {
    console.warn(`Skipping AI provider ${dirName}: entry escapes the package directory`);
    return null;
  }
  try {
    const mod = (await import(pathToFileURL(entryReal).href)) as { plugin?: AiProviderPlugin };
    const plugin = mod.plugin;
    if (!plugin || plugin.id !== dirName) {
      console.warn(`Skipping AI provider ${dirName}: export id does not match the directory`);
      return null;
    }
    return plugin;
  } catch (err) {
    console.warn(
      `Skipping AI provider ${dirName}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
