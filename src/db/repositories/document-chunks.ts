import { getPool } from "@/db/pool";
import { EMBEDDING_DIMENSIONS, type DocumentType } from "@/types/domain";

export type ChunkToPersist = {
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
};

export type VectorSearchResult = {
  id: string;
  documentId: string;
  jobId: string | null;
  documentType: DocumentType;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  distance: number;
  similarity: number;
};

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function replaceDocumentChunks(
  documentId: string,
  chunks: ChunkToPersist[],
): Promise<number> {
  for (const chunk of chunks) {
    if (chunk.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Chunk ${chunk.chunkIndex} has a ${chunk.embedding.length}-dimensional embedding, expected ${EMBEDDING_DIMENSIONS}`,
      );
    }
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM document_chunks WHERE document_id = $1", [documentId]);

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
    return chunks.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function searchSimilarChunks(
  queryEmbedding: number[],
  options: {
    topK?: number;
    filters?: { jobId?: string | null; documentType?: DocumentType };
  } = {},
): Promise<VectorSearchResult[]> {
  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Query embedding has ${queryEmbedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }

  const topK = options.topK ?? 5;
  const filters = options.filters ?? {};
  const result = await getPool().query<{
    id: string;
    document_id: string;
    job_id: string | null;
    document_type: DocumentType;
    chunk_index: number;
    content: string;
    metadata: Record<string, unknown>;
    distance: number;
  }>(
    `SELECT id, document_id, job_id, document_type, chunk_index, content, metadata,
            embedding <=> $1::vector AS distance
       FROM document_chunks
      WHERE embedding IS NOT NULL
        AND ($2::uuid IS NULL OR job_id = $2)
        AND ($3::text IS NULL OR document_type = $3)
      ORDER BY embedding <=> $1::vector
      LIMIT $4`,
    [
      toVectorLiteral(queryEmbedding),
      filters.jobId ?? null,
      filters.documentType ?? null,
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
