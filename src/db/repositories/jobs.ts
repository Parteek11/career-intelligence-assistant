import { getPool } from "@/db/pool";
import type { JobRow } from "@/db/types";
import { isJobSlot, type JobSlot } from "@/types/domain";

export async function listJobs(): Promise<JobRow[]> {
  const result = await getPool().query<JobRow>(`SELECT * FROM jobs ORDER BY slot ASC`);
  return result.rows;
}

export async function getJobBySlot(slot: JobSlot): Promise<JobRow | null> {
  const result = await getPool().query<JobRow>(`SELECT * FROM jobs WHERE slot = $1`, [slot]);
  return result.rows[0] ?? null;
}

export async function upsertJobForSlot(
  slot: JobSlot,
  originalFilename: string,
): Promise<JobRow> {
  if (!isJobSlot(slot)) {
    throw new Error(`Invalid job slot: ${slot}. Must be 1, 2, 3, or 4.`);
  }

  const existing = await getJobBySlot(slot);
  if (existing) {
    const updated = await getPool().query<JobRow>(
      `UPDATE jobs SET original_filename = $1 WHERE id = $2 RETURNING *`,
      [originalFilename, existing.id],
    );
    return updated.rows[0];
  }

  const inserted = await getPool().query<JobRow>(
    `INSERT INTO jobs (slot, original_filename) VALUES ($1, $2) RETURNING *`,
    [slot, originalFilename],
  );
  return inserted.rows[0];
}

export async function deleteJobBySlot(slot: JobSlot): Promise<void> {
  await getPool().query(`DELETE FROM jobs WHERE slot = $1`, [slot]);
}

export async function deleteAllJobs(): Promise<void> {
  await getPool().query(`DELETE FROM jobs`);
}
