import type { Document } from "@langchain/core/documents";
import { EMBEDDING_DIMENSIONS } from "@/types/domain";

export { EMBEDDING_DIMENSIONS };

/**
 * Replaceable interface. Any embedding backend (local Transformers.js,
 * a hosted API, a different model) can implement this without changing
 * callers in the ingestion or persistence layers.
 */
export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly model?: string;
  embed(texts: string[]): Promise<number[][]>;
}

export type EmbeddedChunk = {
  embedding: number[];
  metadata: Document["metadata"];
  chunkIndex: number;
};
