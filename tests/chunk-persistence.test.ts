import { Document } from "@langchain/core/documents";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigrations } from "../src/db/migrate.mjs";
import {
  replaceDocumentChunks,
  searchSimilarChunks,
} from "@/db/repositories/document-chunks";
import { persistIngestedChunks } from "@/services/chunk-persistence";
import { EMBEDDING_DIMENSIONS } from "@/types/domain";
import { createTestPool } from "./helpers/postgres";

function buildVector(activeIndex: number): number[] {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
  vector[activeIndex] = 1;
  return vector;
}

describe("document chunk persistence and vector search", () => {
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

  async function createResumeDocument(filename = "resume.pdf"): Promise<string> {
    const resume = await pool.query<{ id: string }>(
      `INSERT INTO resumes (original_filename) VALUES ($1) RETURNING id`,
      [filename],
    );
    createdResumeIds.push(resume.rows[0].id);

    const document = await pool.query<{ id: string }>(
      `INSERT INTO documents (document_type, resume_id, original_filename, mime_type, file_size)
       VALUES ('resume', $1, $2, 'application/pdf', 100)
       RETURNING id`,
      [resume.rows[0].id, filename],
    );
    createdDocumentIds.push(document.rows[0].id);
    return document.rows[0].id;
  }

  it("inserts chunks with vectors for a document", async () => {
    const documentId = await createResumeDocument();

    const result = await replaceDocumentChunks(
      documentId,
      [
        {
          chunkIndex: 0,
          content: "Built TypeScript APIs with PostgreSQL.",
          embedding: buildVector(0),
          metadata: { section: "experience" },
        },
      ],
      pool,
    );

    expect(result.insertedCount).toBe(1);

    const rows = await pool.query<{ content: string }>(
      `SELECT content FROM document_chunks WHERE document_id = $1`,
      [documentId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].content).toBe("Built TypeScript APIs with PostgreSQL.");
  });

  it("stores the embedding as a 384-dimensional vector", async () => {
    const documentId = await createResumeDocument();

    await replaceDocumentChunks(
      documentId,
      [
        {
          chunkIndex: 0,
          content: "chunk",
          embedding: buildVector(1),
          metadata: {},
        },
      ],
      pool,
    );

    const rows = await pool.query<{ dims: number }>(
      `SELECT vector_dims(embedding) AS dims FROM document_chunks WHERE document_id = $1`,
      [documentId],
    );
    expect(rows.rows[0].dims).toBe(EMBEDDING_DIMENSIONS);
  });

  it("preserves metadata fields on the stored row", async () => {
    const documentId = await createResumeDocument();

    await replaceDocumentChunks(
      documentId,
      [
        {
          chunkIndex: 0,
          content: "chunk",
          embedding: buildVector(2),
          metadata: { section: "skills", source: "resume.pdf" },
        },
      ],
      pool,
    );

    const rows = await pool.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM document_chunks WHERE document_id = $1`,
      [documentId],
    );
    expect(rows.rows[0].metadata).toEqual({
      section: "skills",
      source: "resume.pdf",
    });
  });

  it("returns the nearest chunk first for a similarity query", async () => {
    const documentId = await createResumeDocument();

    await replaceDocumentChunks(
      documentId,
      [
        { chunkIndex: 0, content: "closest", embedding: buildVector(5), metadata: {} },
        { chunkIndex: 1, content: "far", embedding: buildVector(50), metadata: {} },
      ],
      pool,
    );

    const results = await searchSimilarChunks(
      buildVector(5),
      { topK: 1, filters: { documentId } },
      pool,
    );

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("closest");
    expect(results[0].distance).toBeCloseTo(0, 5);
    expect(results[0].similarity).toBeCloseTo(1, 5);
  });

  it("replaces previous chunks instead of duplicating them on re-ingestion", async () => {
    const documentId = await createResumeDocument();

    await replaceDocumentChunks(
      documentId,
      [
        { chunkIndex: 0, content: "first version chunk A", embedding: buildVector(0), metadata: {} },
        { chunkIndex: 1, content: "first version chunk B", embedding: buildVector(1), metadata: {} },
      ],
      pool,
    );

    await replaceDocumentChunks(
      documentId,
      [
        { chunkIndex: 0, content: "second version chunk A", embedding: buildVector(0), metadata: {} },
      ],
      pool,
    );

    const rows = await pool.query<{ content: string }>(
      `SELECT content FROM document_chunks WHERE document_id = $1`,
      [documentId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].content).toBe("second version chunk A");
  });

  it("persists chunks for a job document via the persistence service and preserves job_id", async () => {
    const job = await pool.query<{ id: string }>(
      `INSERT INTO jobs (slot, original_filename) VALUES (2, 'job-2.txt') RETURNING id`,
    );
    createdJobIds.push(job.rows[0].id);

    const document = await pool.query<{ id: string }>(
      `INSERT INTO documents (document_type, job_id, original_filename, mime_type, file_size)
       VALUES ('job_description', $1, 'job-2.txt', 'text/plain', 40)
       RETURNING id`,
      [job.rows[0].id],
    );
    createdDocumentIds.push(document.rows[0].id);

    const chunks = [
      new Document({
        pageContent: "Requires TypeScript and PostgreSQL experience.",
        metadata: {
          document_id: document.rows[0].id,
          document_type: "job_description",
          job_id: job.rows[0].id,
          original_filename: "job-2.txt",
          chunk_index: 0,
          section: "requirements",
        },
      }),
    ];

    const summary = await persistIngestedChunks({
      metadata: {
        documentId: document.rows[0].id,
        documentType: "job_description",
        jobId: job.rows[0].id,
        originalFilename: "job-2.txt",
      },
      chunks,
      embeddings: [buildVector(3)],
    });

    expect(summary.insertedCount).toBe(1);

    const rows = await pool.query<{
      job_id: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT job_id, metadata FROM document_chunks WHERE document_id = $1`,
      [document.rows[0].id],
    );
    expect(rows.rows[0].job_id).toBe(job.rows[0].id);
    expect(rows.rows[0].metadata).toEqual({
      section: "requirements",
      original_filename: "job-2.txt",
    });
  });
});
