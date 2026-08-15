import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Document } from "@langchain/core/documents";
import type { Pool } from "pg";
import { applyMigrations } from "../src/db/migrate.mjs";
import { replaceDocumentChunks } from "@/db/repositories/document-chunks";
import type { AnalysisLLMProvider } from "@/generation/types";
import {
  createQueryId,
  logEvent,
  measure,
  resetObservabilitySink,
  sanitizeLogFields,
  setObservabilitySink,
  startTimer,
  type StructuredLogRecord,
} from "@/lib/observability/logger";
import { embedChunks } from "@/rag/embedding/embed-chunks";
import type { EmbeddingProvider } from "@/rag/embedding/types";
import { EMBEDDING_DIMENSIONS } from "@/types/domain";
import { analyzeCareerFit } from "@/services/career-analysis";
import { ingestUploadedDocument } from "@/services/ingestion";
import { createTestPool } from "./helpers/postgres";

function captureLogs(): StructuredLogRecord[] {
  const records: StructuredLogRecord[] = [];
  setObservabilitySink((record) => {
    records.push(record);
  });
  return records;
}

function buildVector(activeIndex: number): number[] {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
  vector[activeIndex] = 1;
  return vector;
}

function fixedVectorProvider(vector: number[]): EmbeddingProvider {
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    model: "test-embedding",
    embed: async (texts) => texts.map(() => vector),
  };
}

const VALID_MODEL_JSON = JSON.stringify({
  answer: "The candidate has TypeScript experience matching the role.",
  strengths: ["TypeScript"],
  skillGaps: ["insufficient evidence for cloud"],
  experienceAlignment: "Aligned on backend skills.",
  interviewPreparation: ["Discuss the TypeScript project."],
  recommendations: ["Highlight backend work."],
});

describe("structured logger", () => {
  afterEach(() => {
    resetObservabilitySink();
  });

  it("emits the required structured fields", () => {
    const records = captureLogs();

    logEvent({
      operation: "retrieval",
      queryId: "query-1",
      targetJobId: "job-1",
      topK: 5,
      durationMs: 12,
      resultCount: 2,
      retrievedChunkIds: ["chunk-a", "chunk-b"],
      similarityScores: [0.91, 0.74],
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "info",
      operation: "retrieval",
      queryId: "query-1",
      targetJobId: "job-1",
      topK: 5,
      durationMs: 12,
      resultCount: 2,
      retrievedChunkIds: ["chunk-a", "chunk-b"],
      similarityScores: [0.91, 0.74],
    });
    expect(typeof records[0].timestamp).toBe("string");
  });

  it("does not log sensitive document content, prompts, answers, or API keys", () => {
    const records = captureLogs();

    logEvent({
      operation: "generation",
      queryId: "query-2",
      content: "FULL RESUME TEXT that must never be logged",
      prompt: "system and user prompt with candidate details",
      answer: "the generated career analysis answer",
      apiKey: "gsk_this_is_a_secret_key_value",
      durationMs: 8,
      success: true,
    });

    const serialized = JSON.stringify(records[0]);
    expect(records[0]).not.toHaveProperty("content");
    expect(records[0]).not.toHaveProperty("prompt");
    expect(records[0]).not.toHaveProperty("answer");
    expect(records[0]).not.toHaveProperty("apiKey");
    expect(serialized).not.toContain("FULL RESUME TEXT");
    expect(serialized).not.toContain("candidate details");
    expect(serialized).not.toContain("career analysis answer");
    expect(serialized).not.toContain("gsk_this_is_a_secret_key_value");
  });

  it("redacts secret-looking strings even when nested", () => {
    const sanitized = sanitizeLogFields({
      operation: "generation",
      headers: { authorization: "Bearer gsk_abc123" },
      note: "Authorization: Bearer gsk_abc123",
    }) as Record<string, unknown>;

    expect(sanitized.headers).toEqual({});
    expect(sanitized.note).toBe("[redacted]");
    expect(JSON.stringify(sanitized)).not.toContain("gsk_abc123");
  });

  it("records duration from startTimer and measure", async () => {
    const elapsed = startTimer();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(elapsed()).toBeGreaterThanOrEqual(15);

    const measured = await measure(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "ok";
    });

    expect(measured.value).toBe("ok");
    expect(measured.durationMs).toBeGreaterThanOrEqual(15);
  });

  it("creates a correlation/query ID", () => {
    const queryId = createQueryId();
    expect(queryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe("operation logs", () => {
  afterEach(() => {
    resetObservabilitySink();
  });

  it("logs ingestion stats without document text", async () => {
    const records = captureLogs();

    await ingestUploadedDocument({
      file: {
        buffer: Buffer.from("Software Engineer with TypeScript and PostgreSQL experience."),
        filename: "resume.txt",
        mimeType: "text/plain",
      },
      metadata: {
        documentId: "resume-doc-1",
        documentType: "resume",
        jobId: null,
        originalFilename: "resume.txt",
      },
    });

    const ingestion = records.find((record) => record.operation === "ingestion");
    expect(ingestion).toMatchObject({
      documentType: "resume",
      jobId: null,
      filename: "resume.txt",
    });
    expect(typeof ingestion?.durationMs).toBe("number");
    expect(typeof ingestion?.chunkCount).toBe("number");
    expect(typeof ingestion?.averageChunkLength).toBe("number");
    expect(JSON.stringify(ingestion)).not.toContain("Software Engineer");
  });

  it("logs embedding model, chunk count, and duration", async () => {
    const records = captureLogs();

    await embedChunks(
      [
        new Document({
          pageContent: "Built TypeScript APIs with PostgreSQL.",
          metadata: { chunk_index: 0 },
        }),
      ],
      fixedVectorProvider(buildVector(0)),
    );

    expect(records).toEqual([
      expect.objectContaining({
        operation: "embedding",
        model: "test-embedding",
        chunkCount: 1,
      }),
    ]);
    expect(typeof records[0].durationMs).toBe("number");
    expect(JSON.stringify(records[0])).not.toContain("TypeScript APIs");
  });
});

describe("query ID propagation", () => {
  let pool: Pool;
  const createdDocumentIds: string[] = [];
  const createdResumeIds: string[] = [];
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    pool = createTestPool();
    await applyMigrations(pool);
  });

  afterEach(async () => {
    resetObservabilitySink();
    if (createdDocumentIds.length > 0) {
      await pool.query(`DELETE FROM documents WHERE id = ANY($1::uuid[])`, [createdDocumentIds]);
      createdDocumentIds.length = 0;
    }
    if (createdResumeIds.length > 0) {
      await pool.query(`DELETE FROM resumes WHERE id = ANY($1::uuid[])`, [createdResumeIds]);
      createdResumeIds.length = 0;
    }
    if (createdJobIds.length > 0) {
      await pool.query(`DELETE FROM jobs WHERE id = ANY($1::uuid[])`, [createdJobIds]);
      createdJobIds.length = 0;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("uses one queryId for retrieval and generation in a single analysis request", async () => {
    const records = captureLogs();
    const queryId = randomUUID();

    const resume = await pool.query<{ id: string }>(
      `INSERT INTO resumes (original_filename) VALUES ('resume.pdf') RETURNING id`,
    );
    createdResumeIds.push(resume.rows[0].id);

    const resumeDocument = await pool.query<{ id: string }>(
      `INSERT INTO documents (document_type, resume_id, original_filename, mime_type, file_size)
       VALUES ('resume', $1, 'resume.pdf', 'application/pdf', 10)
       RETURNING id`,
      [resume.rows[0].id],
    );
    createdDocumentIds.push(resumeDocument.rows[0].id);

    await replaceDocumentChunks(
      resumeDocument.rows[0].id,
      [
        {
          chunkIndex: 0,
          content: "Built TypeScript APIs with PostgreSQL.",
          embedding: buildVector(0),
          metadata: { original_filename: "resume.pdf" },
        },
      ],
      pool,
    );

    const job = await pool.query<{ id: string }>(
      `INSERT INTO jobs (slot, original_filename) VALUES (1, 'job-1.txt') RETURNING id`,
    );
    createdJobIds.push(job.rows[0].id);

    const jobDocument = await pool.query<{ id: string }>(
      `INSERT INTO documents (document_type, job_id, original_filename, mime_type, file_size)
       VALUES ('job_description', $1, 'job-1.txt', 'text/plain', 10)
       RETURNING id`,
      [job.rows[0].id],
    );
    createdDocumentIds.push(jobDocument.rows[0].id);

    await replaceDocumentChunks(
      jobDocument.rows[0].id,
      [
        {
          chunkIndex: 0,
          content: "Requires TypeScript and PostgreSQL.",
          embedding: buildVector(1),
          metadata: { original_filename: "job-1.txt" },
        },
      ],
      pool,
    );

    const llmProvider: AnalysisLLMProvider = {
      model: "test-llm",
      lastUsage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
      generate: async () => VALID_MODEL_JSON,
    };

    await analyzeCareerFit(
      {
        question: "What skills am I missing for this job?",
        targetJobId: job.rows[0].id,
        queryId,
      },
      {
        provider: fixedVectorProvider(buildVector(1)),
        pool,
        llmProvider,
      },
    );

    const retrieval = records.find((record) => record.operation === "retrieval");
    const generation = records.find((record) => record.operation === "generation");

    expect(retrieval).toMatchObject({
      queryId,
      targetJobId: job.rows[0].id,
      resultCount: expect.any(Number),
    });
    expect(Array.isArray(retrieval?.retrievedChunkIds)).toBe(true);
    expect(Array.isArray(retrieval?.similarityScores)).toBe(true);
    expect(typeof retrieval?.durationMs).toBe("number");

    expect(generation).toMatchObject({
      queryId,
      selectedJob: job.rows[0].id,
      success: true,
      model: "test-llm",
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
    expect(typeof generation?.durationMs).toBe("number");

    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("Built TypeScript APIs");
    expect(serialized).not.toContain(VALID_MODEL_JSON);
  });
});
