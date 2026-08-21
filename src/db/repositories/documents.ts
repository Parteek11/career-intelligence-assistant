import { getPool } from "@/db/pool";
import type { DocumentRow } from "@/db/types";

export async function getDocumentByResumeId(resumeId: string): Promise<DocumentRow | null> {
  const result = await getPool().query<DocumentRow>(
    `SELECT * FROM documents WHERE resume_id = $1`,
    [resumeId],
  );
  return result.rows[0] ?? null;
}

export async function getDocumentByJobId(jobId: string): Promise<DocumentRow | null> {
  const result = await getPool().query<DocumentRow>(
    `SELECT * FROM documents WHERE job_id = $1`,
    [jobId],
  );
  return result.rows[0] ?? null;
}

export async function upsertResumeDocument(input: {
  resumeId: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
}): Promise<DocumentRow> {
  const existing = await getDocumentByResumeId(input.resumeId);

  if (existing) {
    const updated = await getPool().query<DocumentRow>(
      `UPDATE documents
          SET original_filename = $1, mime_type = $2, file_size = $3
        WHERE id = $4
        RETURNING *`,
      [input.originalFilename, input.mimeType, input.fileSize, existing.id],
    );
    return updated.rows[0];
  }

  const inserted = await getPool().query<DocumentRow>(
    `INSERT INTO documents (document_type, resume_id, original_filename, mime_type, file_size)
     VALUES ('resume', $1, $2, $3, $4)
     RETURNING *`,
    [input.resumeId, input.originalFilename, input.mimeType, input.fileSize],
  );
  return inserted.rows[0];
}

export async function upsertJobDocument(input: {
  jobId: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
}): Promise<DocumentRow> {
  const existing = await getDocumentByJobId(input.jobId);

  if (existing) {
    const updated = await getPool().query<DocumentRow>(
      `UPDATE documents
          SET original_filename = $1, mime_type = $2, file_size = $3
        WHERE id = $4
        RETURNING *`,
      [input.originalFilename, input.mimeType, input.fileSize, existing.id],
    );
    return updated.rows[0];
  }

  const inserted = await getPool().query<DocumentRow>(
    `INSERT INTO documents (document_type, job_id, original_filename, mime_type, file_size)
     VALUES ('job_description', $1, $2, $3, $4)
     RETURNING *`,
    [input.jobId, input.originalFilename, input.mimeType, input.fileSize],
  );
  return inserted.rows[0];
}
