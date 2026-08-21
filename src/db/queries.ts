import { getPool } from "@/db/pool";
import { EMBEDDING_DIMENSIONS, isJobSlot, type DocumentType, type JobSlot } from "@/types/domain";

function db() {
  return getPool();
}

type ResumeRow = { id: string; original_filename: string };
type JobRow = { id: string; slot: JobSlot; original_filename: string };
type DocumentRow = { id: string };

export type SimilarChunk = {
  documentType: DocumentType;
  jobId: string | null;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  distance: number;
  similarity: number;
};

function asVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

// --- resume (the app uses one row) ---

export async function getResume(): Promise<ResumeRow | null> {
  const result = await db().query<ResumeRow>(
    `SELECT id, original_filename FROM resumes ORDER BY created_at ASC LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

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

export async function deleteResume(): Promise<void> {
  await db().query(`DELETE FROM resumes`);
}

// --- jobs (slots 1-4) ---

export async function listJobs(): Promise<JobRow[]> {
  const result = await db().query<JobRow>(
    `SELECT id, slot, original_filename FROM jobs ORDER BY slot ASC`,
  );
  return result.rows;
}

export async function getJobBySlot(slot: JobSlot): Promise<JobRow | null> {
  const result = await db().query<JobRow>(
    `SELECT id, slot, original_filename FROM jobs WHERE slot = $1`,
    [slot],
  );
  return result.rows[0] ?? null;
}

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

export async function deleteJobBySlot(slot: JobSlot): Promise<void> {
  await db().query(`DELETE FROM jobs WHERE slot = $1`, [slot]);
}

export async function deleteAllJobs(): Promise<void> {
  await db().query(`DELETE FROM jobs`);
}

// --- documents (one file per resume or per job) ---

async function getResumeDocumentId(resumeId: string): Promise<string | null> {
  const result = await db().query<DocumentRow>(`SELECT id FROM documents WHERE resume_id = $1`, [
    resumeId,
  ]);
  return result.rows[0]?.id ?? null;
}

async function getJobDocumentId(jobId: string): Promise<string | null> {
  const result = await db().query<DocumentRow>(`SELECT id FROM documents WHERE job_id = $1`, [jobId]);
  return result.rows[0]?.id ?? null;
}

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
