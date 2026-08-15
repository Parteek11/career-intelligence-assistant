import "server-only";

import type { Pool } from "pg";
import { getPool } from "@/db/pool";
import type { ResumeRow } from "@/db/types";

/**
 * The application models exactly one resume. The `resumes` table itself
 * does not enforce that (a later multi-user model would add `user_id`
 * instead), so "the resume" here means the oldest row. As long as writes
 * only ever go through upsertResume/deleteResume, at most one row exists.
 */
export async function getResume(pool: Pool = getPool()): Promise<ResumeRow | null> {
  const result = await pool.query<ResumeRow>(
    `SELECT * FROM resumes ORDER BY created_at ASC LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

export async function upsertResume(
  originalFilename: string,
  pool: Pool = getPool(),
): Promise<ResumeRow> {
  const existing = await getResume(pool);

  if (existing) {
    const updated = await pool.query<ResumeRow>(
      `UPDATE resumes SET original_filename = $1 WHERE id = $2 RETURNING *`,
      [originalFilename, existing.id],
    );
    return updated.rows[0];
  }

  const inserted = await pool.query<ResumeRow>(
    `INSERT INTO resumes (original_filename) VALUES ($1) RETURNING *`,
    [originalFilename],
  );
  return inserted.rows[0];
}

/** Deletes the resume. Cascades to its document and document_chunks. */
export async function deleteResume(pool: Pool = getPool()): Promise<void> {
  await pool.query(`DELETE FROM resumes`);
}
