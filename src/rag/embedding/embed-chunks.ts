import type { Document } from "@langchain/core/documents";
import { logEvent, startTimer } from "@/lib/observability/logger";
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
  const elapsed = startTimer();

  if (chunks.length === 0) {
    logEmbedding(provider, 0, elapsed());
    return [];
  }

  const texts = chunks.map((chunk) => chunk.pageContent);
  const vectors = await provider.embed(texts);

  if (vectors.length !== chunks.length) {
    throw new IngestionError(
      `Embedding provider returned ${vectors.length} vectors for ${chunks.length} chunks`,
    );
  }

  const embedded = chunks.map((chunk, index) => ({
    embedding: vectors[index],
    metadata: chunk.metadata,
    chunkIndex: readChunkIndex(chunk, index),
  }));

  logEmbedding(provider, chunks.length, elapsed());
  return embedded;
}

function logEmbedding(provider: EmbeddingProvider, chunkCount: number, durationMs: number): void {
  logEvent({
    operation: "embedding",
    model: provider.model ?? "unknown",
    chunkCount,
    durationMs,
  });
}

function readChunkIndex(chunk: Document, fallback: number): number {
  const value = chunk.metadata.chunk_index;
  return typeof value === "number" ? value : fallback;
}
