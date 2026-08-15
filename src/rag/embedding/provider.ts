import { TransformersEmbeddingProvider } from "@/rag/embedding/transformers-provider";
import type { EmbeddingProvider } from "@/rag/embedding/types";

let defaultProvider: EmbeddingProvider | null = null;

/**
 * Single shared provider instance so the underlying model is loaded once.
 * Swap the class here (or inject a different provider via embedChunks)
 * to change embedding backends without touching callers.
 */
export function getDefaultEmbeddingProvider(): EmbeddingProvider {
  if (!defaultProvider) {
    defaultProvider = new TransformersEmbeddingProvider();
  }

  return defaultProvider;
}
