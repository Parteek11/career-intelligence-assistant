/**
 * Shared domain primitives used by RAG, DB queries, and the UI.
 *
 * Job identity is the slot number (1–4), not the filename. Embedding
 * width is pinned to MiniLM-L6-v2 so a model swap cannot silently write
 * the wrong vector size into `document_chunks.embedding vector(384)`.
 */

export const JOB_SLOTS = [1, 2, 3, 4] as const;
export type JobSlot = (typeof JOB_SLOTS)[number];

/** Type guard used before any job upsert or delete. */
export function isJobSlot(value: number): value is JobSlot {
  return (JOB_SLOTS as readonly number[]).includes(value);
}

/** A document (and its chunks) is either the resume or a job description. */
export type DocumentType = "resume" | "job_description";

/** Dimension of Xenova/all-MiniLM-L6-v2 embeddings. Must match the pgvector column. */
export const EMBEDDING_DIMENSIONS = 384 as const;
