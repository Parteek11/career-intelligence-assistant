import "server-only";

import type { Document } from "@langchain/core/documents";
import type { Pool } from "pg";
import {
  replaceDocumentChunks,
  type ChunkToPersist,
  type PersistedChunksSummary,
} from "@/db/repositories/document-chunks";
import { IngestionError } from "@/rag/errors";
import type { IngestionDocumentMetadata } from "@/rag/types";

export type PersistIngestedChunksInput = {
  metadata: IngestionDocumentMetadata;
  chunks: Document[];
  embeddings: number[][];
  pool?: Pool;
};

/**
 * Accepts the document metadata, chunked LangChain Documents, and the
 * embeddings generated for them, and writes them to `document_chunks`.
 * Any previous chunks for this document are replaced, so re-ingesting the
 * same document (re-upload, different chunking) never duplicates rows.
 */
export async function persistIngestedChunks(
  input: PersistIngestedChunksInput,
): Promise<PersistedChunksSummary> {
  if (input.chunks.length !== input.embeddings.length) {
    throw new IngestionError(
      `Received ${input.chunks.length} chunks but ${input.embeddings.length} embeddings`,
    );
  }

  const toPersist: ChunkToPersist[] = input.chunks.map((chunk, index) => ({
    chunkIndex: readChunkIndex(chunk, index),
    content: chunk.pageContent,
    embedding: input.embeddings[index],
    metadata: stripDenormalizedColumns(chunk.metadata),
  }));

  const summary = await replaceDocumentChunks(
    input.metadata.documentId,
    toPersist,
    input.pool,
  );

  return summary;
}

function readChunkIndex(chunk: Document, fallback: number): number {
  const value = chunk.metadata.chunk_index;
  return typeof value === "number" ? value : fallback;
}

const DENORMALIZED_METADATA_KEYS = [
  "document_id",
  "document_type",
  "job_id",
  "chunk_index",
] as const;

/**
 * document_id, document_type, job_id, and chunk_index already have their
 * own columns (document_type/job_id are also trigger-enforced from the
 * parent document), so they are not duplicated into the metadata JSONB.
 */
function stripDenormalizedColumns(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => !DENORMALIZED_METADATA_KEYS.includes(key as never),
    ),
  );
}
