import { getPool } from "@/db/pool";
import { EMBEDDING_DIMENSIONS, isJobSlot, type DocumentType, type JobSlot } from "@/types/domain";

/**
 * All SQL for the app lives here. Services never write raw queries.
 *
 * Domain shape (see `src/db/migrations/001_domain_schema.sql`):
 *   resumes  1 ──< documents  1 ──< document_chunks
 *   jobs     1 ──< documents  1 ──< document_chunks
 *
 * A document belongs to exactly one resume *or* one job. Chunk rows copy
 * `document_type` and `job_id` from the parent via a BEFORE INSERT trigger,
 * so retrieval can filter Job 1–4 with no join. Resume chunks always have
 * `job_id = null`.
 */

/** Shortcut so every query uses the same pooled client. */
function db() {
  return getPool();
}

type ResumeRow = { id: string; original_filename: string };
type JobRow = { id: string; slot: JobSlot; original_filename: string };
type DocumentRow = { id: string };

/** One cosine-search hit, with distance (pgvector) and similarity (1 − distance). */
export type SimilarChunk = {
  documentType: DocumentType;
  jobId: string | null;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  distance: number;
  similarity: number;
};

/**
 * Format a JS number array as a pgvector literal: `[0.1,0.2,…]`.
 * The SQL then casts it with `$1::vector` so the `<=>` operator type-checks.
 */
function asVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

// --- resume (the app uses one row) ---

/** Return the oldest resume row, or null if none has been uploaded. */
export async function getResume(): Promise<ResumeRow | null> {
  const result = await db().query<ResumeRow>(
    `SELECT id, original_filename FROM resumes ORDER BY created_at ASC LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

/**
 * Keep a single resume: update the existing row, or insert the first one.
 * Re-upload changes the filename but keeps the same `id` so the document
 * FK and later CASCADE deletes stay stable.
 */
export async function upsertResume(originalFilename: string): Promise<ResumeRow> {
  const existing = await getResume();
  if (existing) {
    const result = await db().query<ResumeRow>(
      `UPDATE resumes SET original_filename = $1 WHERE id = $2 RETURNING id, original_filename`,
      [originalFilename, existing.id],
    );
    return result.rows[0];
  }

  const result = await db().query<ResumeRow>(
    `INSERT INTO resumes (original_filename) VALUES ($1) RETURNING id, original_filename`,
    [originalFilename],
  );
  return result.rows[0];
}

/** Delete every resume. CASCADE removes the resume document and its chunks. */
export async function deleteResume(): Promise<void> {
  await db().query(`DELETE FROM resumes`);
}

// --- jobs (slots 1-4) ---

/** All uploaded jobs, ordered by slot so Best Match and the UI stay aligned. */
export async function listJobs(): Promise<JobRow[]> {
  const result = await db().query<JobRow>(
    `SELECT id, slot, original_filename FROM jobs ORDER BY slot ASC`,
  );
  return result.rows;
}

/** Look up the job UUID for a UI slot (1–4). */
export async function getJobBySlot(slot: JobSlot): Promise<JobRow | null> {
  const result = await db().query<JobRow>(
    `SELECT id, slot, original_filename FROM jobs WHERE slot = $1`,
    [slot],
  );
  return result.rows[0] ?? null;
}

/**
 * Create or replace the job in a slot. Slot is the stable identity —
 * uploading a new file into slot 2 updates that row instead of inserting
 * a fifth job. The UUID is reused so existing document FKs stay valid.
 */
export async function upsertJobForSlot(slot: JobSlot, originalFilename: string): Promise<JobRow> {
  if (!isJobSlot(slot)) {
    throw new Error(`Invalid job slot: ${slot}. Must be 1, 2, 3, or 4.`);
  }

  const existing = await getJobBySlot(slot);
  if (existing) {
    const result = await db().query<JobRow>(
      `UPDATE jobs SET original_filename = $1 WHERE id = $2 RETURNING id, slot, original_filename`,
      [originalFilename, existing.id],
    );
    return result.rows[0];
  }

  const result = await db().query<JobRow>(
    `INSERT INTO jobs (slot, original_filename) VALUES ($1, $2) RETURNING id, slot, original_filename`,
    [slot, originalFilename],
  );
  return result.rows[0];
}

/** Delete one slot. CASCADE removes its document and chunks. */
export async function deleteJobBySlot(slot: JobSlot): Promise<void> {
  await db().query(`DELETE FROM jobs WHERE slot = $1`, [slot]);
}

/** Delete every job (used by Clear all and evaluation cleanup). */
export async function deleteAllJobs(): Promise<void> {
  await db().query(`DELETE FROM jobs`);
}

// --- documents (one file per resume or per job) ---

/** The unique document attached to a resume, if any. */
async function getResumeDocumentId(resumeId: string): Promise<string | null> {
  const result = await db().query<DocumentRow>(`SELECT id FROM documents WHERE resume_id = $1`, [
    resumeId,
  ]);
  return result.rows[0]?.id ?? null;
}

/** The unique document attached to a job, if any. */
async function getJobDocumentId(jobId: string): Promise<string | null> {
  const result = await db().query<DocumentRow>(`SELECT id FROM documents WHERE job_id = $1`, [jobId]);
  return result.rows[0]?.id ?? null;
}

/**
 * Refresh file metadata on a re-upload without changing parent identity.
 * `document_type` / `resume_id` / `job_id` are immutable (enforced by a
 * trigger) so chunk denormalized columns cannot drift.
 */
async function saveDocumentFile(
  documentId: string,
  originalFilename: string,
  mimeType: string,
  fileSize: number,
): Promise<DocumentRow> {
  const result = await db().query<DocumentRow>(
    `UPDATE documents
        SET original_filename = $1, mime_type = $2, file_size = $3
      WHERE id = $4
      RETURNING id`,
    [originalFilename, mimeType, fileSize, documentId],
  );
  return result.rows[0];
}

/**
 * Ensure the resume has exactly one `documents` row.
 * Unique partial index `documents_one_per_resume_idx` also enforces this.
 */
export async function upsertResumeDocument(input: {
  resumeId: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
}): Promise<DocumentRow> {
  const existingId = await getResumeDocumentId(input.resumeId);
  if (existingId) {
    return saveDocumentFile(existingId, input.originalFilename, input.mimeType, input.fileSize);
  }

  const result = await db().query<DocumentRow>(
    `INSERT INTO documents (document_type, resume_id, original_filename, mime_type, file_size)
     VALUES ('resume', $1, $2, $3, $4)
     RETURNING id`,
    [input.resumeId, input.originalFilename, input.mimeType, input.fileSize],
  );
  return result.rows[0];
}

/**
 * Ensure the job has exactly one `documents` row.
 * `job_id` is set and `resume_id` stays null — the CHECK constraint
 * `documents_exactly_one_parent` rejects any other combination.
 */
export async function upsertJobDocument(input: {
  jobId: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
}): Promise<DocumentRow> {
  const existingId = await getJobDocumentId(input.jobId);
  if (existingId) {
    return saveDocumentFile(existingId, input.originalFilename, input.mimeType, input.fileSize);
  }

  const result = await db().query<DocumentRow>(
    `INSERT INTO documents (document_type, job_id, original_filename, mime_type, file_size)
     VALUES ('job_description', $1, $2, $3, $4)
     RETURNING id`,
    [input.jobId, input.originalFilename, input.mimeType, input.fileSize],
  );
  return result.rows[0];
}

// --- chunks (RAG rows + cosine search) ---

/**
 * Replace every chunk for a document in one transaction.
 *
 * Delete-then-insert is required because chunk count and boundaries change
 * on every re-upload. Doing it outside a transaction could leave the
 * document with no vectors (or a mix of old and new) if the process
 * crashes mid-insert. Each embedding is checked against
 * `EMBEDDING_DIMENSIONS` (384) before we touch the table so a model
 * mismatch fails before any DELETE.
 *
 * We take a dedicated client (`connect`) because BEGIN/COMMIT must run
 * on the same connection. `ROLLBACK` is best-effort if the transaction
 * already aborted. `job_id` / `document_type` are *not* passed here —
 * the `document_chunks_set_source` trigger copies them from `documents`.
 */
export async function replaceDocumentChunks(
  documentId: string,
  chunks: {
    chunkIndex: number;
    content: string;
    embedding: number[];
    metadata: Record<string, unknown>;
  }[],
): Promise<number> {
  for (const chunk of chunks) {
    if (chunk.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Chunk ${chunk.chunkIndex} has a ${chunk.embedding.length}-dimensional embedding, expected ${EMBEDDING_DIMENSIONS}`,
      );
    }
  }

  const client = await db().connect();
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
          asVector(chunk.embedding),
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

/**
 * Cosine nearest-neighbor search over `document_chunks`.
 *
 * `embedding <=> $1::vector` is pgvector cosine *distance* (0 = identical,
 * 2 = opposite on unit vectors). We return both `distance` (for sorting)
 * and `similarity = 1 - distance` (for the UI / prompt, where 1 is a
 * perfect match).
 *
 * Filters are optional NULL parameters so one query covers all cases:
 * - `$2` job UUID → restrict to that job's JD chunks
 * - `$3` document type → `'resume'` or `'job_description'`
 * Passing SQL `NULL` for a filter disables it (`$2::uuid IS NULL OR …`).
 *
 * Rows with a null embedding are skipped (a document that was uploaded
 * before vectors were written). There is no ANN index — the corpus is
 * small enough that an exact sort is fine.
 */
export async function searchSimilarChunks(
  queryEmbedding: number[],
  options: {
    topK?: number;
    filters?: { jobId?: string | null; documentType?: DocumentType };
  } = {},
): Promise<SimilarChunk[]> {
  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Query embedding has ${queryEmbedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }

  const topK = options.topK ?? 5;
  const filters = options.filters ?? {};
  const result = await db().query<{
    document_type: DocumentType;
    job_id: string | null;
    chunk_index: number;
    content: string;
    metadata: Record<string, unknown>;
    distance: number;
  }>(
    `SELECT document_type, job_id, chunk_index, content, metadata,
            embedding <=> $1::vector AS distance
       FROM document_chunks
      WHERE embedding IS NOT NULL
        AND ($2::uuid IS NULL OR job_id = $2)
        AND ($3::text IS NULL OR document_type = $3)
      ORDER BY embedding <=> $1::vector
      LIMIT $4`,
    [asVector(queryEmbedding), filters.jobId ?? null, filters.documentType ?? null, topK],
  );

  return result.rows.map((row) => ({
    documentType: row.document_type,
    jobId: row.job_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    metadata: row.metadata,
    distance: row.distance,
    similarity: 1 - row.distance,
  }));
}
