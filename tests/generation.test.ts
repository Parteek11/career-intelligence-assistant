import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { applyMigrations } from "../src/db/migrate.mjs";
import { replaceDocumentChunks } from "@/db/repositories/document-chunks";
import { GenerationError } from "@/generation/errors";
import { parseAnalysisResponse } from "@/generation/parse-analysis";
import { buildGroundedPrompt } from "@/generation/prompt";
import type { AnalysisLLMProvider } from "@/generation/types";
import { analyzeCareerFit } from "@/services/career-analysis";
import type { CareerEvidenceItem } from "@/services/retrieval";
import { EMBEDDING_DIMENSIONS } from "@/types/domain";
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

function fakeLlmProvider(response: string | Error): AnalysisLLMProvider {
  return {
    generate: async () => {
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
  };
}

const VALID_MODEL_JSON = JSON.stringify({
  answer: "The candidate has direct TypeScript and PostgreSQL experience matching the role.",
  strengths: ["TypeScript backend development", "PostgreSQL API experience"],
  skillGaps: ["insufficient evidence for cloud infrastructure experience"],
  experienceAlignment: "Strong alignment on core backend stack requirements.",
  interviewPreparation: ["Be ready to discuss the PostgreSQL API project in detail."],
  recommendations: ["Highlight the TypeScript API project on the resume summary."],
});

describe("buildGroundedPrompt", () => {
  const sampleEvidence: CareerEvidenceItem[] = [
    {
      content: "Built TypeScript APIs with PostgreSQL.",
      similarity: 0.9123,
      documentType: "resume",
      jobId: null,
      filename: "resume.pdf",
      chunkIndex: 0,
    },
    {
      content: "Requires 3+ years of TypeScript and PostgreSQL experience.",
      similarity: 0.8421,
      documentType: "job_description",
      jobId: "job-1-uuid",
      filename: "job-1.txt",
      chunkIndex: 1,
    },
  ];

  it("includes grounding rules that forbid inventing candidate experience", () => {
    const prompt = buildGroundedPrompt("What skills am I missing?", sampleEvidence);

    expect(prompt.system).toMatch(/only the retrieved evidence/i);
    expect(prompt.system).toMatch(/never invent/i);
    expect(prompt.system).toMatch(/insufficient evidence/i);
    expect(prompt.system).toMatch(/do not assume a skill is definitely absent/i);
    expect(prompt.system).toMatch(/distinguish candidate evidence/i);
  });

  it("includes required source metadata and content for every evidence item", () => {
    const prompt = buildGroundedPrompt("What skills am I missing?", sampleEvidence);

    expect(prompt.user).toContain("document_type=resume");
    expect(prompt.user).toContain("document_type=job_description");
    expect(prompt.user).toContain("job_id=job-1-uuid");
    expect(prompt.user).toContain("filename=resume.pdf");
    expect(prompt.user).toContain("filename=job-1.txt");
    expect(prompt.user).toContain("chunk_index=1");
    expect(prompt.user).toContain("similarity=0.8421");
    expect(prompt.user).toContain("Built TypeScript APIs with PostgreSQL.");
    expect(prompt.user).toContain("Requires 3+ years of TypeScript and PostgreSQL experience.");
    expect(prompt.user).toContain("What skills am I missing?");
  });

  it("marks an empty evidence list explicitly instead of an empty block", () => {
    const prompt = buildGroundedPrompt("What skills am I missing?", []);
    expect(prompt.user).toContain("no evidence retrieved");
  });
});

describe("parseAnalysisResponse", () => {
  it("parses a valid model response into the typed shape", () => {
    const result = parseAnalysisResponse(VALID_MODEL_JSON);

    expect(result.answer).toContain("TypeScript");
    expect(result.strengths).toEqual([
      "TypeScript backend development",
      "PostgreSQL API experience",
    ]);
    expect(result.skillGaps).toHaveLength(1);
    expect(result.experienceAlignment).toBeTypeOf("string");
    expect(result.interviewPreparation).toHaveLength(1);
    expect(result.recommendations).toHaveLength(1);
  });

  it("throws GenerationError for text that is not JSON", () => {
    expect(() => parseAnalysisResponse("not json at all")).toThrow(GenerationError);
  });

  it("throws GenerationError when a required field is missing", () => {
    const missingField = JSON.stringify({
      answer: "ok",
      strengths: [],
      skillGaps: [],
      experienceAlignment: "ok",
      interviewPreparation: [],
      // recommendations omitted
    });

    expect(() => parseAnalysisResponse(missingField)).toThrow(GenerationError);
  });

  it("throws GenerationError when a field has the wrong type", () => {
    const wrongType = JSON.stringify({
      answer: "ok",
      strengths: "should be an array",
      skillGaps: [],
      experienceAlignment: "ok",
      interviewPreparation: [],
      recommendations: [],
    });

    expect(() => parseAnalysisResponse(wrongType)).toThrow(GenerationError);
  });

  it("throws GenerationError for a JSON array instead of an object", () => {
    expect(() => parseAnalysisResponse("[1, 2, 3]")).toThrow(GenerationError);
  });
});

describe("analyzeCareerFit", () => {
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

  async function createResumeChunk(embedding: number[]): Promise<void> {
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
  }

  async function createJobChunk(
    slot: 1 | 2 | 3 | 4,
    embedding: number[],
    content: string,
  ): Promise<string> {
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

    return job.rows[0].id;
  }

  it("throws GenerationError and never calls the LLM when no evidence is retrieved", async () => {
    const generate = vi.fn();

    await expect(
      analyzeCareerFit(
        { question: "What skills am I missing?", targetJobId: randomUUID() },
        {
          provider: fixedVectorProvider(buildVector(0)),
          pool,
          llmProvider: { generate },
        },
      ),
    ).rejects.toBeInstanceOf(GenerationError);

    expect(generate).not.toHaveBeenCalled();
  });

  it("returns a validated CareerAnalysis with sources built from retrieved evidence", async () => {
    await createResumeChunk(buildVector(0));
    const jobId = await createJobChunk(1, buildVector(1), "Requires TypeScript and PostgreSQL.");

    const result = await analyzeCareerFit(
      { question: "What skills am I missing for this job?", targetJobId: jobId, topK: 5 },
      {
        provider: fixedVectorProvider(buildVector(1)),
        pool,
        llmProvider: fakeLlmProvider(VALID_MODEL_JSON),
      },
    );

    expect(result.answer).toContain("TypeScript");
    expect(result.strengths.length).toBeGreaterThan(0);
    expect(result.skillGaps.length).toBeGreaterThan(0);
    expect(result.sources.length).toBe(2);
    expect(result.sources.some((source) => source.documentType === "resume")).toBe(true);
    expect(
      result.sources.some(
        (source) => source.documentType === "job_description" && source.jobId === jobId,
      ),
    ).toBe(true);
    for (const source of result.sources) {
      expect(source.filename).not.toBeUndefined();
      expect(typeof source.chunkIndex).toBe("number");
      expect(typeof source.similarity).toBe("number");
    }
  });

  it("throws GenerationError when the LLM returns invalid output", async () => {
    await createResumeChunk(buildVector(0));
    const jobId = await createJobChunk(1, buildVector(1), "Requires TypeScript and PostgreSQL.");

    await expect(
      analyzeCareerFit(
        { question: "What skills am I missing?", targetJobId: jobId },
        {
          provider: fixedVectorProvider(buildVector(1)),
          pool,
          llmProvider: fakeLlmProvider("this is not json"),
        },
      ),
    ).rejects.toBeInstanceOf(GenerationError);
  });

  it("wraps an unexpected provider failure in GenerationError", async () => {
    await createResumeChunk(buildVector(0));
    const jobId = await createJobChunk(1, buildVector(1), "Requires TypeScript and PostgreSQL.");

    await expect(
      analyzeCareerFit(
        { question: "What skills am I missing?", targetJobId: jobId },
        {
          provider: fixedVectorProvider(buildVector(1)),
          pool,
          llmProvider: fakeLlmProvider(new Error("network down")),
        },
      ),
    ).rejects.toBeInstanceOf(GenerationError);
  });
});
