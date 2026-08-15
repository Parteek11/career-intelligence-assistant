import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigrations } from "../src/db/migrate.mjs";
import { replaceDocumentChunks } from "@/db/repositories/document-chunks";
import { retrieveCareerEvidence, RetrievalError } from "@/services/retrieval";
import { EMBEDDING_DIMENSIONS } from "@/types/domain";
import type { EmbeddingProvider } from "@/rag/embedding/types";
import { createTestPool } from "./helpers/postgres";

function buildVector(activeIndex: number): number[] {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
  vector[activeIndex] = 1;
  return vector;
}

/** Ignores the input text and always returns a preset vector, so tests can
 * control exactly which stored chunk a "query" should be closest to. */
function fixedVectorProvider(vector: number[]): EmbeddingProvider {
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    embed: async (texts) => texts.map(() => vector),
  };
}

describe("retrieveCareerEvidence", () => {
  let pool: Pool;
  const createdDocumentIds: string[] = [];
  const createdResumeIds: string[] = [];
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    pool = createTestPool();
    await applyMigrations(pool);
  });

  afterEach(async () => {
    if (createdDocumentIds.length > 0) {
      await pool.query(`DELETE FROM documents WHERE id = ANY($1::uuid[])`, [
        createdDocumentIds,
      ]);
      createdDocumentIds.length = 0;
    }
    if (createdResumeIds.length > 0) {
      await pool.query(`DELETE FROM resumes WHERE id = ANY($1::uuid[])`, [
        createdResumeIds,
      ]);
      createdResumeIds.length = 0;
    }
    if (createdJobIds.length > 0) {
      await pool.query(`DELETE FROM jobs WHERE id = ANY($1::uuid[])`, [
        createdJobIds,
      ]);
      createdJobIds.length = 0;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createResumeChunk(embedding: number[]): Promise<string> {
    const resume = await pool.query<{ id: string }>(
      `INSERT INTO resumes (original_filename) VALUES ('resume.pdf') RETURNING id`,
    );
    createdResumeIds.push(resume.rows[0].id);

    const document = await pool.query<{ id: string }>(
      `INSERT INTO documents (document_type, resume_id, original_filename, mime_type, file_size)
       VALUES ('resume', $1, 'resume.pdf', 'application/pdf', 10)
       RETURNING id`,
      [resume.rows[0].id],
    );
    createdDocumentIds.push(document.rows[0].id);

    await replaceDocumentChunks(
      document.rows[0].id,
      [
        {
          chunkIndex: 0,
          content: "Built TypeScript APIs with PostgreSQL.",
          embedding,
          metadata: { original_filename: "resume.pdf" },
        },
      ],
      pool,
    );

    return document.rows[0].id;
  }

  async function createJobChunk(
    slot: 1 | 2 | 3 | 4,
    embedding: number[],
    content: string,
  ): Promise<{ jobId: string; documentId: string }> {
    const filename = `job-${slot}.txt`;
    const job = await pool.query<{ id: string }>(
      `INSERT INTO jobs (slot, original_filename) VALUES ($1, $2) RETURNING id`,
      [slot, filename],
    );
    createdJobIds.push(job.rows[0].id);

    const document = await pool.query<{ id: string }>(
      `INSERT INTO documents (document_type, job_id, original_filename, mime_type, file_size)
       VALUES ('job_description', $1, $2, 'text/plain', 10)
       RETURNING id`,
      [job.rows[0].id, filename],
    );
    createdDocumentIds.push(document.rows[0].id);

    await replaceDocumentChunks(
      document.rows[0].id,
      [
        {
          chunkIndex: 0,
          content,
          embedding,
          metadata: { original_filename: filename },
        },
      ],
      pool,
    );

    return { jobId: job.rows[0].id, documentId: document.rows[0].id };
  }

  it("returns an empty array for a job with no chunks and no error", async () => {
    const results = await retrieveCareerEvidence(
      { query: "TypeScript and PostgreSQL experience", targetJobId: randomUUID() },
      { provider: fixedVectorProvider(buildVector(0)), pool },
    );

    expect(results).toEqual([]);
  });

  it("rejects an empty query", async () => {
    await expect(
      retrieveCareerEvidence(
        { query: "   ", targetJobId: "all" },
        { provider: fixedVectorProvider(buildVector(0)), pool },
      ),
    ).rejects.toBeInstanceOf(RetrievalError);
  });

  it("returns resume + only the selected job's chunks for a specific job query", async () => {
    await createResumeChunk(buildVector(0));
    const job1 = await createJobChunk(1, buildVector(1), "Job 1 requires TypeScript.");
    await createJobChunk(2, buildVector(2), "Job 2 requires marketing skills.");

    const results = await retrieveCareerEvidence(
      { query: "backend engineering role", targetJobId: job1.jobId, topK: 5 },
      { provider: fixedVectorProvider(buildVector(1)), pool },
    );

    const documentTypes = results.map((item) => item.documentType).sort();
    expect(documentTypes).toEqual(["job_description", "resume"]);

    const jobItem = results.find((item) => item.documentType === "job_description");
    expect(jobItem?.jobId).toBe(job1.jobId);

    const resumeItem = results.find((item) => item.documentType === "resume");
    expect(resumeItem?.jobId).toBeNull();

    expect(results.some((item) => item.jobId && item.jobId !== job1.jobId)).toBe(
      false,
    );
  });

  it("does not return Job 1 chunks for a Job 2 query", async () => {
    await createResumeChunk(buildVector(0));
    const job1 = await createJobChunk(1, buildVector(1), "Job 1 requires TypeScript.");
    const job2 = await createJobChunk(2, buildVector(2), "Job 2 requires marketing skills.");

    const results = await retrieveCareerEvidence(
      { query: "marketing role", targetJobId: job2.jobId, topK: 5 },
      { provider: fixedVectorProvider(buildVector(2)), pool },
    );

    expect(results.some((item) => item.jobId === job1.jobId)).toBe(false);
    expect(results.some((item) => item.jobId === job2.jobId)).toBe(true);
  });

  it("returns chunks from multiple jobs for an all-jobs query", async () => {
    await createResumeChunk(buildVector(0));
    const job1 = await createJobChunk(1, buildVector(1), "Job 1 requires TypeScript.");
    const job2 = await createJobChunk(2, buildVector(2), "Job 2 requires marketing skills.");

    const results = await retrieveCareerEvidence(
      { query: "any role", targetJobId: "all", topK: 10 },
      { provider: fixedVectorProvider(buildVector(1)), pool },
    );

    const jobIds = new Set(
      results.filter((item) => item.jobId !== null).map((item) => item.jobId),
    );
    expect(jobIds.has(job1.jobId)).toBe(true);
    expect(jobIds.has(job2.jobId)).toBe(true);
    expect(results.some((item) => item.documentType === "resume")).toBe(true);
  });

  it("preserves similarity ranking across the merged resume and job results", async () => {
    await createResumeChunk(buildVector(0));
    const job1 = await createJobChunk(1, buildVector(1), "Job 1 requires TypeScript.");

    // Query vector matches the job chunk exactly (distance 0) and is
    // orthogonal to the resume chunk (distance 1), so the job chunk must
    // rank first.
    const results = await retrieveCareerEvidence(
      { query: "TypeScript role", targetJobId: job1.jobId, topK: 5 },
      { provider: fixedVectorProvider(buildVector(1)), pool },
    );

    expect(results).toHaveLength(2);
    expect(results[0].documentType).toBe("job_description");
    expect(results[0].similarity).toBeCloseTo(1, 5);
    expect(results[1].documentType).toBe("resume");
    expect(results[1].similarity).toBeLessThan(results[0].similarity);
  });

  it("includes filename and chunk index on returned evidence", async () => {
    await createResumeChunk(buildVector(0));
    const job1 = await createJobChunk(1, buildVector(1), "Job 1 requires TypeScript.");

    const results = await retrieveCareerEvidence(
      { query: "TypeScript role", targetJobId: job1.jobId },
      { provider: fixedVectorProvider(buildVector(1)), pool },
    );

    const jobItem = results.find((item) => item.documentType === "job_description");
    expect(jobItem?.filename).toBe("job-1.txt");
    expect(jobItem?.chunkIndex).toBe(0);
  });
});
