import "server-only";

import type { Pool, PoolClient } from "pg";
import { getPool } from "@/db/pool";
import { DatabaseError } from "@/db/errors";
import { toVectorLiteral } from "@/db/vector";
import { EMBEDDING_DIMENSIONS, type DocumentType } from "@/types/domain";

export type ChunkToPersist = {
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
};

export type PersistedChunksSummary = {
  documentId: string;
  insertedCount: number;
};

/**
 * Replaces all chunks for a document in a single transaction: delete then
 * insert. Re-ingesting a document (new upload, changed chunking config)
 * therefore never leaves duplicate or stale chunks behind, and a failed
 * insert leaves the previous chunks untouched.
 */
export async function replaceDocumentChunks(
  documentId: string,
  chunks: ChunkToPersist[],
  pool: Pool = getPool(),
): Promise<PersistedChunksSummary> {
  for (const chunk of chunks) {
    if (chunk.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new DatabaseError(
        `Chunk ${chunk.chunkIndex} has a ${chunk.embedding.length}-dimensional embedding, expected ${EMBEDDING_DIMENSIONS}`,
      );
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM document_chunks WHERE document_id = $1", [
      documentId,
    ]);

    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO document_chunks (document_id, chunk_index, content, embedding, metadata)
         VALUES ($1, $2, $3, $4::vector, $5::jsonb)`,
        [
          documentId,
          chunk.chunkIndex,
          chunk.content,
          toVectorLiteral(chunk.embedding),
          JSON.stringify(chunk.metadata),
        ],
      );
    }

    await client.query("COMMIT");
    return { documentId, insertedCount: chunks.length };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The transaction may already be aborted or closed.
  }
}

export type VectorSearchFilters = {
  jobId?: string | null;
  documentType?: DocumentType;
  documentId?: string;
};

export type VectorSearchOptions = {
  topK?: number;
  filters?: VectorSearchFilters;
};

export type VectorSearchResult = {
  id: string;
  documentId: string;
  jobId: string | null;
  documentType: DocumentType;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  /** Cosine distance from pgvector's `<=>` operator. 0 = identical direction, 2 = opposite. */
  distance: number;
  /** `1 - distance`, i.e. cosine similarity. 1 = identical direction. */
  similarity: number;
};

type VectorSearchRow = {
  id: string;
  document_id: string;
  job_id: string | null;
  document_type: DocumentType;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  distance: number;
};

/**
 * Nearest-neighbor search using pgvector's cosine-distance operator (`<=>`)
 * directly in SQL. Ranking and distance computation happen in Postgres;
 * only the top `topK` rows are ever sent back to Node.
 */
export async function searchSimilarChunks(
  queryEmbedding: number[],
  options: VectorSearchOptions = {},
  pool: Pool = getPool(),
): Promise<VectorSearchResult[]> {
  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
    throw new DatabaseError(
      `Query embedding has ${queryEmbedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }

  const topK = options.topK ?? 5;
  const filters = options.filters ?? {};

  const result = await pool.query<VectorSearchRow>(
    `SELECT id, document_id, job_id, document_type, chunk_index, content, metadata,
            embedding <=> $1::vector AS distance
       FROM document_chunks
      WHERE embedding IS NOT NULL
        AND ($2::uuid IS NULL OR job_id = $2)
        AND ($3::text IS NULL OR document_type = $3)
        AND ($4::uuid IS NULL OR document_id = $4)
      ORDER BY embedding <=> $1::vector
      LIMIT $5`,
    [
      toVectorLiteral(queryEmbedding),
      filters.jobId ?? null,
      filters.documentType ?? null,
      filters.documentId ?? null,
      topK,
    ],
  );

  return result.rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    jobId: row.job_id,
    documentType: row.document_type,
    chunkIndex: row.chunk_index,
    content: row.content,
    metadata: row.metadata,
    distance: row.distance,
    similarity: 1 - row.distance,
  }));
}
