import "server-only";

import type { Pool } from "pg";
import { getPool } from "@/db/pool";
import type { DocumentRow } from "@/db/types";

export type UpsertResumeDocumentInput = {
  resumeId: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
};

export type UpsertJobDocumentInput = {
  jobId: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
};

export async function getDocumentByResumeId(
  resumeId: string,
  pool: Pool = getPool(),
): Promise<DocumentRow | null> {
  const result = await pool.query<DocumentRow>(
    `SELECT * FROM documents WHERE resume_id = $1`,
    [resumeId],
  );
  return result.rows[0] ?? null;
}

export async function getDocumentByJobId(
  jobId: string,
  pool: Pool = getPool(),
): Promise<DocumentRow | null> {
  const result = await pool.query<DocumentRow>(
    `SELECT * FROM documents WHERE job_id = $1`,
    [jobId],
  );
  return result.rows[0] ?? null;
}

/**
 * Reuses the resume's existing document row on re-upload (only filename,
 * mime type, and size change — those columns are the only ones the
 * immutable-parent trigger allows to be updated), or creates one if this
 * is the first upload.
 */
export async function upsertResumeDocument(
  input: UpsertResumeDocumentInput,
  pool: Pool = getPool(),
): Promise<DocumentRow> {
  const existing = await getDocumentByResumeId(input.resumeId, pool);

  if (existing) {
    const updated = await pool.query<DocumentRow>(
      `UPDATE documents
          SET original_filename = $1, mime_type = $2, file_size = $3
        WHERE id = $4
        RETURNING *`,
      [input.originalFilename, input.mimeType, input.fileSize, existing.id],
    );
    return updated.rows[0];
  }

  const inserted = await pool.query<DocumentRow>(
    `INSERT INTO documents (document_type, resume_id, original_filename, mime_type, file_size)
     VALUES ('resume', $1, $2, $3, $4)
     RETURNING *`,
    [input.resumeId, input.originalFilename, input.mimeType, input.fileSize],
  );
  return inserted.rows[0];
}

/** Same reuse-on-re-upload behavior as upsertResumeDocument, for a job's document. */
export async function upsertJobDocument(
  input: UpsertJobDocumentInput,
  pool: Pool = getPool(),
): Promise<DocumentRow> {
  const existing = await getDocumentByJobId(input.jobId, pool);

  if (existing) {
    const updated = await pool.query<DocumentRow>(
      `UPDATE documents
          SET original_filename = $1, mime_type = $2, file_size = $3
        WHERE id = $4
        RETURNING *`,
      [input.originalFilename, input.mimeType, input.fileSize, existing.id],
    );
    return updated.rows[0];
  }

  const inserted = await pool.query<DocumentRow>(
    `INSERT INTO documents (document_type, job_id, original_filename, mime_type, file_size)
     VALUES ('job_description', $1, $2, $3, $4)
     RETURNING *`,
    [input.jobId, input.originalFilename, input.mimeType, input.fileSize],
  );
  return inserted.rows[0];
}
