import { getPool } from "@/db/pool";
import type { ResumeRow } from "@/db/types";

export async function getResume(): Promise<ResumeRow | null> {
  const result = await getPool().query<ResumeRow>(
    `SELECT * FROM resumes ORDER BY created_at ASC LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

export async function upsertResume(originalFilename: string): Promise<ResumeRow> {
  const existing = await getResume();

  if (existing) {
    const updated = await getPool().query<ResumeRow>(
      `UPDATE resumes SET original_filename = $1 WHERE id = $2 RETURNING *`,
      [originalFilename, existing.id],
    );
    return updated.rows[0];
  }

  const inserted = await getPool().query<ResumeRow>(
    `INSERT INTO resumes (original_filename) VALUES ($1) RETURNING *`,
    [originalFilename],
  );
  return inserted.rows[0];
}

export async function deleteResume(): Promise<void> {
  await getPool().query(`DELETE FROM resumes`);
}
