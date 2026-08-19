import type { Document } from "@langchain/core/documents";
import { IngestionError } from "@/rag/errors";
import { getDefaultEmbeddingProvider } from "@/rag/embedding/provider";
import type { EmbeddedChunk, EmbeddingProvider } from "@/rag/embedding/types";

/**
 * Turns chunked ingestion Documents into embedding vectors plus their
 * original metadata. Does not persist anything and does not know about
 * pgvector or Postgres — that is a later, separate step.
 */
export async function embedChunks(
  chunks: Document[],
  provider: EmbeddingProvider = getDefaultEmbeddingProvider(),
): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) {
    return [];
  }

  const texts = chunks.map((chunk) => chunk.pageContent);
  const vectors = await provider.embed(texts);

  if (vectors.length !== chunks.length) {
    throw new IngestionError(
      `Embedding provider returned ${vectors.length} vectors for ${chunks.length} chunks`,
    );
  }

  return chunks.map((chunk, index) => ({
    embedding: vectors[index],
    metadata: chunk.metadata,
    chunkIndex: readChunkIndex(chunk, index),
  }));
}

function readChunkIndex(chunk: Document, fallback: number): number {
  const value = chunk.metadata.chunk_index;
  return typeof value === "number" ? value : fallback;
}
