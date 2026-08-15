import "server-only";

import type { Pool } from "pg";
import { getPool } from "@/db/pool";
import { DatabaseError } from "@/db/errors";
import type { JobRow } from "@/db/types";
import { isJobSlot, type JobSlot } from "@/types/domain";

export async function listJobs(pool: Pool = getPool()): Promise<JobRow[]> {
  const result = await pool.query<JobRow>(`SELECT * FROM jobs ORDER BY slot ASC`);
  return result.rows;
}

export async function getJobBySlot(
  slot: JobSlot,
  pool: Pool = getPool(),
): Promise<JobRow | null> {
  assertValidSlot(slot);
  const result = await pool.query<JobRow>(`SELECT * FROM jobs WHERE slot = $1`, [slot]);
  return result.rows[0] ?? null;
}

/**
 * Creates the job for this slot if it doesn't exist yet, or updates its
 * filename in place if it does. The job's id (and therefore any existing
 * document/chunks handled by the caller) stays stable across re-uploads.
 */
export async function upsertJobForSlot(
  slot: JobSlot,
  originalFilename: string,
  pool: Pool = getPool(),
): Promise<JobRow> {
  assertValidSlot(slot);

  const existing = await getJobBySlot(slot, pool);
  if (existing) {
    const updated = await pool.query<JobRow>(
      `UPDATE jobs SET original_filename = $1 WHERE id = $2 RETURNING *`,
      [originalFilename, existing.id],
    );
    return updated.rows[0];
  }

  const inserted = await pool.query<JobRow>(
    `INSERT INTO jobs (slot, original_filename) VALUES ($1, $2) RETURNING *`,
    [slot, originalFilename],
  );
  return inserted.rows[0];
}

/** Deletes the job at this slot. Cascades to its document and document_chunks. */
export async function deleteJobBySlot(slot: JobSlot, pool: Pool = getPool()): Promise<void> {
  assertValidSlot(slot);
  await pool.query(`DELETE FROM jobs WHERE slot = $1`, [slot]);
}

/** Deletes every job (all slots). Cascades to their documents and document_chunks. */
export async function deleteAllJobs(pool: Pool = getPool()): Promise<void> {
  await pool.query(`DELETE FROM jobs`);
}

function assertValidSlot(slot: number): asserts slot is JobSlot {
  if (!isJobSlot(slot)) {
    throw new DatabaseError(`Invalid job slot: ${slot}. Must be 1, 2, 3, or 4.`);
  }
}
