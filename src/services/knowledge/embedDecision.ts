import type { AiAccess } from "../assistant/aiAccess.js";

export const EMBEDDING_DIM = 768;

/**
 * Ideas and other records with no project are embedded.
 * A project record is embedded unless its effective access is excluded.
 */
export function shouldEmbedRecord(projectId: number | null, access: AiAccess | null): boolean {
  if (projectId == null) return true;
  return access != null && access !== "excluded";
}

export type StoredEmbedding = {
  hash: string;
  model: string | null;
  embedding: number[] | null;
};

/**
 * `null` clears the vector. `undefined` means the caller must embed this chunk.
 * A matching hash and model reuses the stored vector.
 */
export function reusedEmbedding(
  previous: StoredEmbedding | undefined,
  hash: string,
  model: string | null,
  embed: boolean,
): number[] | null | undefined {
  if (!embed) return null;
  if (
    previous &&
    previous.hash === hash &&
    previous.model === model &&
    previous.embedding &&
    previous.embedding.length === EMBEDDING_DIM
  ) {
    return previous.embedding;
  }
  return undefined;
}
