import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../src/db/migrate.mjs";
import { EMBEDDING_DIMENSIONS } from "@/types/domain";
import {
  createTestPool,
  isPostgresError,
  withRolledBackTransaction,
} from "./helpers/postgres";
import type { Pool } from "pg";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const INTEGRITY_CONSTRAINT_VIOLATION = "23000";

describe("domain schema", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    await applyMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates the expected tables", async () => {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('resumes', 'jobs', 'documents', 'document_chunks')
        ORDER BY table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "document_chunks",
      "documents",
      "jobs",
      "resumes",
    ]);
  });

  it("prepares document_chunks.embedding as vector(384)", async () => {
    const result = await pool.query<{ format: string }>(
      `SELECT format_type(atttypid, atttypmod) AS format
         FROM pg_attribute
        WHERE attrelid = 'document_chunks'::regclass
          AND attname = 'embedding'`,
    );

    expect(result.rows[0]?.format).toBe(`vector(${EMBEDDING_DIMENSIONS})`);
  });

  it("rejects job slots outside 1-4", async () => {
    await withRolledBackTransaction(pool, async (client) => {
      try {
        await client.query(
          `INSERT INTO jobs (slot, original_filename)
           VALUES (5, 'out-of-range.txt')`,
        );
        throw new Error("expected slot check to fail");
      } catch (error) {
        expect(isPostgresError(error) && error.code).toBe(CHECK_VIOLATION);
      }
    });
  });

  it("rejects a second job in the same slot", async () => {
    await withRolledBackTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO jobs (slot, original_filename)
         VALUES (1, 'job-a.txt')`,
      );

      try {
        await client.query(
          `INSERT INTO jobs (slot, original_filename)
           VALUES (1, 'job-b.txt')`,
        );
        throw new Error("expected unique slot to fail");
      } catch (error) {
        expect(isPostgresError(error) && error.code).toBe(UNIQUE_VIOLATION);
      }
    });
  });

  it("rejects a document that belongs to both a resume and a job", async () => {
    await withRolledBackTransaction(pool, async (client) => {
      const resume = await client.query<{ id: string }>(
        `INSERT INTO resumes (original_filename)
         VALUES ('resume.pdf')
         RETURNING id`,
      );
      const job = await client.query<{ id: string }>(
        `INSERT INTO jobs (slot, original_filename)
         VALUES (2, 'job.txt')
         RETURNING id`,
      );

      try {
        await client.query(
          `INSERT INTO documents (
             document_type, resume_id, job_id, original_filename, mime_type, file_size
           ) VALUES ('resume', $1, $2, 'resume.pdf', 'application/pdf', 12)`,
          [resume.rows[0].id, job.rows[0].id],
        );
        throw new Error("expected exclusive parent check to fail");
      } catch (error) {
        expect(isPostgresError(error) && error.code).toBe(CHECK_VIOLATION);
      }
    });
  });

  it("rejects a document with neither resume nor job", async () => {
    await withRolledBackTransaction(pool, async (client) => {
      try {
        await client.query(
          `INSERT INTO documents (
             document_type, original_filename, mime_type, file_size
           ) VALUES ('resume', 'resume.pdf', 'application/pdf', 12)`,
        );
        throw new Error("expected missing parent check to fail");
      } catch (error) {
        expect(isPostgresError(error) && error.code).toBe(CHECK_VIOLATION);
      }
    });
  });

  it("copies job_id from the parent document onto chunks", async () => {
    await withRolledBackTransaction(pool, async (client) => {
      const job = await client.query<{ id: string }>(
        `INSERT INTO jobs (slot, original_filename)
         VALUES (3, 'job-3.txt')
         RETURNING id`,
      );
      const document = await client.query<{ id: string }>(
        `INSERT INTO documents (
           document_type, job_id, original_filename, mime_type, file_size
         ) VALUES ('job_description', $1, 'job-3.txt', 'text/plain', 20)
         RETURNING id`,
        [job.rows[0].id],
      );

      const chunk = await client.query<{
        job_id: string | null;
        document_type: string;
      }>(
        `INSERT INTO document_chunks (document_id, chunk_index, content)
         VALUES ($1, 0, 'Required: TypeScript')
         RETURNING job_id, document_type`,
        [document.rows[0].id],
      );

      expect(chunk.rows[0].job_id).toBe(job.rows[0].id);
      expect(chunk.rows[0].document_type).toBe("job_description");
    });
  });

  it("stores resume chunks with a null job_id", async () => {
    await withRolledBackTransaction(pool, async (client) => {
      const resume = await client.query<{ id: string }>(
        `INSERT INTO resumes (original_filename)
         VALUES ('resume.pdf')
         RETURNING id`,
      );
      const document = await client.query<{ id: string }>(
        `INSERT INTO documents (
           document_type, resume_id, original_filename, mime_type, file_size
         ) VALUES ('resume', $1, 'resume.pdf', 'application/pdf', 40)
         RETURNING id`,
        [resume.rows[0].id],
      );

      const chunk = await client.query<{ job_id: string | null }>(
        `INSERT INTO document_chunks (document_id, chunk_index, content)
         VALUES ($1, 0, 'Built APIs in TypeScript')
         RETURNING job_id`,
        [document.rows[0].id],
      );

      expect(chunk.rows[0].job_id).toBeNull();
    });
  });

  it("rejects duplicate chunk_index values for the same document", async () => {
    await withRolledBackTransaction(pool, async (client) => {
      const resume = await client.query<{ id: string }>(
        `INSERT INTO resumes (original_filename)
         VALUES ('resume.pdf')
         RETURNING id`,
      );
      const document = await client.query<{ id: string }>(
        `INSERT INTO documents (
           document_type, resume_id, original_filename, mime_type, file_size
         ) VALUES ('resume', $1, 'resume.pdf', 'application/pdf', 40)
         RETURNING id`,
        [resume.rows[0].id],
      );

      await client.query(
        `INSERT INTO document_chunks (document_id, chunk_index, content)
         VALUES ($1, 0, 'first')`,
        [document.rows[0].id],
      );

      try {
        await client.query(
          `INSERT INTO document_chunks (document_id, chunk_index, content)
           VALUES ($1, 0, 'duplicate')`,
          [document.rows[0].id],
        );
        throw new Error("expected unique chunk_index to fail");
      } catch (error) {
        expect(isPostgresError(error) && error.code).toBe(UNIQUE_VIOLATION);
      }
    });
  });

  it("prevents changing a document parent after insert", async () => {
    await withRolledBackTransaction(pool, async (client) => {
      const resume = await client.query<{ id: string }>(
        `INSERT INTO resumes (original_filename)
         VALUES ('resume.pdf')
         RETURNING id`,
      );
      const document = await client.query<{ id: string }>(
        `INSERT INTO documents (
           document_type, resume_id, original_filename, mime_type, file_size
         ) VALUES ('resume', $1, 'resume.pdf', 'application/pdf', 40)
         RETURNING id`,
        [resume.rows[0].id],
      );
      const job = await client.query<{ id: string }>(
        `INSERT INTO jobs (slot, original_filename)
         VALUES (1, 'job-1.txt')
         RETURNING id`,
      );

      try {
        await client.query(
          `UPDATE documents
              SET document_type = 'job_description',
                  resume_id = NULL,
                  job_id = $2
            WHERE id = $1`,
          [document.rows[0].id, job.rows[0].id],
        );
        throw new Error("expected immutable parent to fail");
      } catch (error) {
        expect(isPostgresError(error) && error.code).toBe(
          INTEGRITY_CONSTRAINT_VIOLATION,
        );
      }
    });
  });
});
