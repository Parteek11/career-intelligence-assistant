import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigrations } from "../src/db/migrate.mjs";
import { getJobBySlot, listJobs } from "@/db/repositories/jobs";
import { getResume } from "@/db/repositories/resumes";
import { analyzeCareerFit } from "@/services/career-analysis";
import {
  clearAll,
  deleteJobDescription,
  uploadJobDescription,
  uploadResume,
} from "@/services/document-management";
import { EMBEDDING_DIMENSIONS } from "@/types/domain";
import type { AnalysisLLMProvider } from "@/generation/types";
import type { EmbeddingProvider } from "@/rag/embedding/types";
import { createTestPool } from "./helpers/postgres";

function buildVector(activeIndex: number): number[] {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
  vector[activeIndex] = 1;
  return vector;
}

function fixedVectorProvider(vector: number[]): EmbeddingProvider {
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    embed: async (texts) => texts.map(() => vector),
  };
}

function fakeLlmProvider(json: Record<string, unknown>): AnalysisLLMProvider {
  return { generate: async () => JSON.stringify(json) };
}

const VALID_ANALYSIS = {
  answer: "The candidate is a strong fit for the core requirements.",
  strengths: ["TypeScript backend experience"],
  skillGaps: ["insufficient evidence for cloud infrastructure"],
  experienceAlignment: "Good alignment on backend fundamentals.",
  interviewPreparation: ["Review the PostgreSQL project in depth."],
  recommendations: ["Highlight the ingestion pipeline work."],
};

describe("document management", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    await applyMigrations(pool);
  });

  afterEach(async () => {
    await pool.query("DELETE FROM jobs");
    await pool.query("DELETE FROM resumes");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("uploads a resume and creates a document with chunks", async () => {
    const summary = await uploadResume(
      {
        buffer: Buffer.from("Built TypeScript APIs with PostgreSQL."),
        filename: "resume.txt",
        mimeType: "text/plain",
      },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(0)) },
    );

    expect(summary.chunkCount).toBeGreaterThan(0);

    const resume = await getResume(pool);
    expect(resume?.original_filename).toBe("resume.txt");

    const chunkRows = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM document_chunks WHERE document_id = $1",
      [summary.documentId],
    );
    expect(chunkRows.rows[0].count).toBe(summary.chunkCount);
  });

  it("uploads Job 1 and Job 2 into distinct slots", async () => {
    const job1 = await uploadJobDescription(
      1,
      { buffer: Buffer.from("Job 1 requires TypeScript."), filename: "job-1.txt", mimeType: "text/plain" },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(1)) },
    );
    const job2 = await uploadJobDescription(
      2,
      { buffer: Buffer.from("Job 2 requires marketing skills."), filename: "job-2.txt", mimeType: "text/plain" },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(2)) },
    );

    expect(job1.chunkCount).toBeGreaterThan(0);
    expect(job2.chunkCount).toBeGreaterThan(0);

    const jobRow1 = await getJobBySlot(1, pool);
    const jobRow2 = await getJobBySlot(2, pool);
    expect(jobRow1?.original_filename).toBe("job-1.txt");
    expect(jobRow2?.original_filename).toBe("job-2.txt");
    expect(jobRow1?.id).not.toBe(jobRow2?.id);

    const jobs = await listJobs(pool);
    expect(jobs).toHaveLength(2);
  });

  it("replaces Job 1's document and chunks cleanly on re-upload", async () => {
    const first = await uploadJobDescription(
      1,
      {
        buffer: Buffer.from("Original job 1 description mentioning TypeScript."),
        filename: "job-1-v1.txt",
        mimeType: "text/plain",
      },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(1)) },
    );

    const second = await uploadJobDescription(
      1,
      {
        buffer: Buffer.from("Replaced job 1 description mentioning Python instead."),
        filename: "job-1-v2.txt",
        mimeType: "text/plain",
      },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(1)) },
    );

    const jobRow = await getJobBySlot(1, pool);
    expect(jobRow?.original_filename).toBe("job-1-v2.txt");

    const jobs = await listJobs(pool);
    expect(jobs).toHaveLength(1);

    // The document row is reused across a replace (same document id), and
    // its chunks now reflect only the new content.
    expect(second.documentId).toBe(first.documentId);

    const chunkRows = await pool.query<{ content: string }>(
      "SELECT content FROM document_chunks WHERE document_id = $1",
      [second.documentId],
    );
    expect(chunkRows.rows).toHaveLength(second.chunkCount);
    expect(chunkRows.rows.every((row) => row.content.includes("Replaced"))).toBe(true);
    expect(chunkRows.rows.some((row) => row.content.includes("Original"))).toBe(false);
  });

  it("deletes Job 2's document and chunks", async () => {
    const job2 = await uploadJobDescription(
      2,
      { buffer: Buffer.from("Job 2 requires marketing skills."), filename: "job-2.txt", mimeType: "text/plain" },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(2)) },
    );

    await deleteJobDescription(2, { pool });

    expect(await getJobBySlot(2, pool)).toBeNull();

    const documentRows = await pool.query("SELECT id FROM documents WHERE id = $1", [
      job2.documentId,
    ]);
    expect(documentRows.rows).toHaveLength(0);

    const chunkRows = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM document_chunks WHERE document_id = $1",
      [job2.documentId],
    );
    expect(chunkRows.rows[0].count).toBe(0);
  });

  it("clears the resume and all jobs, removing related documents and chunks", async () => {
    await uploadResume(
      { buffer: Buffer.from("Resume text."), filename: "resume.txt", mimeType: "text/plain" },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(0)) },
    );
    await uploadJobDescription(
      1,
      { buffer: Buffer.from("Job 1 text."), filename: "job-1.txt", mimeType: "text/plain" },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(1)) },
    );
    await uploadJobDescription(
      3,
      { buffer: Buffer.from("Job 3 text."), filename: "job-3.txt", mimeType: "text/plain" },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(3)) },
    );

    await clearAll({ pool });

    expect(await getResume(pool)).toBeNull();
    expect(await listJobs(pool)).toEqual([]);

    const remainingChunks = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM document_chunks",
    );
    expect(remainingChunks.rows[0].count).toBe(0);

    const remainingDocuments = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM documents",
    );
    expect(remainingDocuments.rows[0].count).toBe(0);
  });

  it("routes the selected Job 2 to analyzeCareerFit and excludes Job 1", async () => {
    await uploadResume(
      {
        buffer: Buffer.from("Built TypeScript APIs with PostgreSQL."),
        filename: "resume.txt",
        mimeType: "text/plain",
      },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(0)) },
    );
    await uploadJobDescription(
      1,
      { buffer: Buffer.from("Job 1 requires TypeScript."), filename: "job-1.txt", mimeType: "text/plain" },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(1)) },
    );
    await uploadJobDescription(
      2,
      { buffer: Buffer.from("Job 2 requires marketing skills."), filename: "job-2.txt", mimeType: "text/plain" },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(2)) },
    );

    // Mirrors the /api/analyze route's slot -> jobId resolution for a
    // "Job 2" selection from the UI's job selector.
    const selectedJob = await getJobBySlot(2, pool);
    expect(selectedJob).not.toBeNull();

    const result = await analyzeCareerFit(
      { question: "What skills am I missing for this job?", targetJobId: selectedJob!.id },
      {
        pool,
        provider: fixedVectorProvider(buildVector(2)),
        llmProvider: fakeLlmProvider(VALID_ANALYSIS),
      },
    );

    expect(
      result.sources.some(
        (source) => source.documentType === "job_description" && source.jobId === selectedJob!.id,
      ),
    ).toBe(true);
    expect(
      result.sources.every((source) => source.jobId === null || source.jobId === selectedJob!.id),
    ).toBe(true);
  });
});
