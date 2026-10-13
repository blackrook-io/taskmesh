import { getAiProvider } from "../assistant/providerLoader.js";
import { assertLocalProviderBaseUrl } from "../assistant/providerBaseUrl.js";
import { getSystemProperties } from "../systemProperties.js";
import { db } from "../../db/client.js";
import { EMBEDDING_DIM } from "./embedDecision.js";

export type EmbedBatch = {
  model: string;
  vectors: number[][] | null;
};

/** Configured Ollama embedding model, or null when Ollama embeddings are off. */
export async function readEmbeddingModel(): Promise<string | null> {
  const ready = await ollamaEmbedTarget();
  return ready?.model ?? null;
}

/** Embed with the enabled Ollama plugin. Null vectors mean full-text only for this batch. */
export async function embedTexts(texts: string[]): Promise<EmbedBatch | null> {
  if (texts.length === 0) {
    const model = await readEmbeddingModel();
    return model ? { model, vectors: [] } : null;
  }
  const ready = await ollamaEmbedTarget();
  const embed = ready?.plugin.embed;
  if (!ready || !embed) return null;
  const { config, model } = ready;
  try {
    const result = await embed(
      {
        config,
        apiKey: null,
        assertBaseUrl: assertLocalProviderBaseUrl,
      },
      texts,
    );
    if (
      result.vectors.length !== texts.length ||
      result.vectors.some((row) => row.length !== EMBEDDING_DIM)
    ) {
      console.error("[knowledge] Ollama embedding length is not 768; storing full-text only");
      return { model, vectors: null };
    }
    return { model, vectors: result.vectors };
  } catch (err) {
    console.error("[knowledge] embed failed", err);
    return null;
  }
}

async function ollamaEmbedTarget(): Promise<{
  plugin: NonNullable<ReturnType<typeof getAiProvider>>;
  config: unknown;
  model: string;
} | null> {
  const plugin = getAiProvider("ollama");
  if (!plugin?.embed || !plugin.capabilities.embeddings) return null;
  const props = await getSystemProperties(db);
  const entry = props.aiProviders.ollama;
  if (!entry?.enabled) return null;
  const parsed = plugin.configSchema.safeParse(entry.config);
  if (!parsed.success) return null;
  return { plugin, config: parsed.data, model: embeddingModelOf(parsed.data) };
}

function embeddingModelOf(config: unknown): string {
  if (config && typeof config === "object" && "embeddingModel" in config) {
    const value = (config as { embeddingModel?: unknown }).embeddingModel;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "nomic-embed-text";
}
