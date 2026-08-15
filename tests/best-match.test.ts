import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { applyMigrations } from "../src/db/migrate.mjs";
import type { CategoryScores } from "@/generation/best-match-types";
import { GenerationError } from "@/generation/errors";
import { parseBestMatchResponse } from "@/generation/parse-best-match";
import { calculateWeightedScore, DEFAULT_SCORE_WEIGHTS } from "@/generation/scoring";
import type { AnalysisLLMProvider, GroundedPrompt } from "@/generation/types";
import { getJobBySlot } from "@/db/repositories/jobs";
import { findBestMatch } from "@/services/best-match";
import { uploadJobDescription, uploadResume } from "@/services/document-management";
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

function categoryScoresProvider(
  categoryScores: CategoryScores,
  extra: { strengths?: string[]; skillGaps?: string[]; reasoning?: string } = {},
): AnalysisLLMProvider {
  return {
    generate: async () =>
      JSON.stringify({
        categoryScores,
        strengths: extra.strengths ?? ["Relevant experience"],
        skillGaps: extra.skillGaps ?? ["insufficient evidence for one requirement"],
        reasoning: extra.reasoning ?? "Reasoning based on the retrieved evidence.",
      }),
  };
}

/** Returns high scores for evidence containing STRONG_MATCH_MARKER and low
 * scores otherwise, so the test can control which job "wins" without a
 * real model call. */
function evidenceAwareProvider(): AnalysisLLMProvider {
  return {
    generate: async (prompt: GroundedPrompt) => {
      const isStrong = prompt.user.includes("STRONG_MATCH_MARKER");
      const categoryScores: CategoryScores = isStrong
        ? {
            technicalSkillAlignment: 90,
            experienceAlignment: 85,
            domainAlignment: 80,
            leadershipSeniorityAlignment: 75,
          }
        : {
            technicalSkillAlignment: 20,
            experienceAlignment: 15,
            domainAlignment: 10,
            leadershipSeniorityAlignment: 5,
          };

      return JSON.stringify({
        categoryScores,
        strengths: isStrong ? ["Strong technical match"] : [],
        skillGaps: isStrong ? [] : ["Missing most requirements"],
        reasoning: isStrong ? "Strong evidence throughout." : "Weak evidence throughout.",
      });
    },
  };
}

const VALID_CATEGORY_SCORES: CategoryScores = {
  technicalSkillAlignment: 80,
  experienceAlignment: 70,
  domainAlignment: 60,
  leadershipSeniorityAlignment: 50,
};

describe("parseBestMatchResponse", () => {
  it("parses a valid response into the typed shape", () => {
    const raw = JSON.stringify({
      categoryScores: VALID_CATEGORY_SCORES,
      strengths: ["a"],
      skillGaps: ["b"],
      reasoning: "ok",
    });

    const result = parseBestMatchResponse(raw);
    expect(result.categoryScores).toEqual(VALID_CATEGORY_SCORES);
    expect(result.strengths).toEqual(["a"]);
    expect(result.skillGaps).toEqual(["b"]);
    expect(result.reasoning).toBe("ok");
  });

  it("rejects a category score above 100", () => {
    const raw = JSON.stringify({
      categoryScores: { ...VALID_CATEGORY_SCORES, technicalSkillAlignment: 150 },
      strengths: [],
      skillGaps: [],
      reasoning: "ok",
    });

    expect(() => parseBestMatchResponse(raw)).toThrow(GenerationError);
  });

  it("rejects a missing category", () => {
    const partial = Object.fromEntries(
      Object.entries(VALID_CATEGORY_SCORES).filter(
        ([key]) => key !== "leadershipSeniorityAlignment",
      ),
    );
    const raw = JSON.stringify({
      categoryScores: partial,
      strengths: [],
      skillGaps: [],
      reasoning: "ok",
    });

    expect(() => parseBestMatchResponse(raw)).toThrow(GenerationError);
  });

  it("rejects a non-numeric category score", () => {
    const raw = JSON.stringify({
      categoryScores: { ...VALID_CATEGORY_SCORES, domainAlignment: "high" },
      strengths: [],
      skillGaps: [],
      reasoning: "ok",
    });

    expect(() => parseBestMatchResponse(raw)).toThrow(GenerationError);
  });
});

describe("calculateWeightedScore", () => {
  it("computes a weighted average using the default weights", () => {
    const score = calculateWeightedScore(VALID_CATEGORY_SCORES, DEFAULT_SCORE_WEIGHTS);
    const expected =
      (80 * 0.4 + 70 * 0.3 + 60 * 0.2 + 50 * 0.1) /
      (0.4 + 0.3 + 0.2 + 0.1);
    expect(score).toBeCloseTo(expected, 5);
  });

  it("normalizes by total weight when custom weights are provided", () => {
    const equalWeights = {
      technicalSkillAlignment: 1,
      experienceAlignment: 1,
      domainAlignment: 1,
      leadershipSeniorityAlignment: 1,
    };
    const score = calculateWeightedScore(VALID_CATEGORY_SCORES, equalWeights);
    expect(score).toBeCloseTo((80 + 70 + 60 + 50) / 4, 5);
  });
});

describe("findBestMatch", () => {
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

  async function seedResume(): Promise<void> {
    await uploadResume(
      {
        buffer: Buffer.from("Built TypeScript APIs with PostgreSQL."),
        filename: "resume.txt",
        mimeType: "text/plain",
      },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(0)) },
    );
  }

  it("throws a clear error when no jobs have been uploaded", async () => {
    await seedResume();

    await expect(
      findBestMatch({ pool, provider: fixedVectorProvider(buildVector(0)) }),
    ).rejects.toBeInstanceOf(GenerationError);
  });

  it("returns one result for a single uploaded job", async () => {
    await seedResume();
    await uploadJobDescription(
      1,
      { buffer: Buffer.from("Job 1 requires TypeScript."), filename: "job-1.txt", mimeType: "text/plain" },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(1)) },
    );
    const job = await getJobBySlot(1, pool);

    const results = await findBestMatch({
      pool,
      provider: fixedVectorProvider(buildVector(1)),
      llmProvider: categoryScoresProvider(VALID_CATEGORY_SCORES),
    });

    expect(results).toHaveLength(1);
    expect(results[0].jobId).toBe(job?.id);
    expect(results[0].jobSlot).toBe(1);
    expect(results[0].sources.length).toBeGreaterThan(0);
  });

  it("returns two results for two uploaded jobs", async () => {
    await seedResume();
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

    const results = await findBestMatch({
      pool,
      provider: fixedVectorProvider(buildVector(1)),
      llmProvider: categoryScoresProvider(VALID_CATEGORY_SCORES),
    });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.jobSlot).sort()).toEqual([1, 2]);
  });

  it("ranks the job with stronger matching evidence higher", async () => {
    await seedResume();
    await uploadJobDescription(
      1,
      {
        buffer: Buffer.from("STRONG_MATCH_MARKER Job 1 requires TypeScript and PostgreSQL."),
        filename: "job-1.txt",
        mimeType: "text/plain",
      },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(1)) },
    );
    await uploadJobDescription(
      2,
      {
        buffer: Buffer.from("WEAK_MATCH_MARKER Job 2 requires unrelated skills."),
        filename: "job-2.txt",
        mimeType: "text/plain",
      },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(2)) },
    );

    const results = await findBestMatch({
      pool,
      provider: fixedVectorProvider(buildVector(1)),
      llmProvider: evidenceAwareProvider(),
    });

    expect(results).toHaveLength(2);
    expect(results[0].jobSlot).toBe(1);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    // Results are sorted descending by score.
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it("ignores a job with no retrievable evidence", async () => {
    await seedResume();
    await uploadJobDescription(
      1,
      { buffer: Buffer.from("Job 1 requires TypeScript."), filename: "job-1.txt", mimeType: "text/plain" },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(1)) },
    );
    const job2 = await uploadJobDescription(
      2,
      { buffer: Buffer.from("Job 2 requires marketing skills."), filename: "job-2.txt", mimeType: "text/plain" },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(2)) },
    );

    // Simulates a job whose upload never finished processing: the job row
    // exists but it has no chunks to retrieve evidence from.
    await pool.query("DELETE FROM document_chunks WHERE document_id = $1", [job2.documentId]);

    const results = await findBestMatch({
      pool,
      provider: fixedVectorProvider(buildVector(1)),
      llmProvider: categoryScoresProvider(VALID_CATEGORY_SCORES),
    });

    expect(results).toHaveLength(1);
    expect(results[0].jobSlot).toBe(1);
  });

  it("computes the final score in application code from the model's category scores", async () => {
    await seedResume();
    await uploadJobDescription(
      1,
      { buffer: Buffer.from("Job 1 requires TypeScript."), filename: "job-1.txt", mimeType: "text/plain" },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(1)) },
    );

    const results = await findBestMatch({
      pool,
      provider: fixedVectorProvider(buildVector(1)),
      llmProvider: categoryScoresProvider(VALID_CATEGORY_SCORES),
    });

    const expectedScore = calculateWeightedScore(VALID_CATEGORY_SCORES, DEFAULT_SCORE_WEIGHTS);
    expect(results[0].score).toBe(expectedScore);
  });

  it("propagates a GenerationError when the LLM returns invalid category scores", async () => {
    await seedResume();
    await uploadJobDescription(
      1,
      { buffer: Buffer.from("Job 1 requires TypeScript."), filename: "job-1.txt", mimeType: "text/plain" },
      { pool, embeddingProvider: fixedVectorProvider(buildVector(1)) },
    );

    const invalidProvider: AnalysisLLMProvider = {
      generate: async () =>
        JSON.stringify({
          categoryScores: { ...VALID_CATEGORY_SCORES, technicalSkillAlignment: 999 },
          strengths: [],
          skillGaps: [],
          reasoning: "ok",
        }),
    };

    await expect(
      findBestMatch({ pool, provider: fixedVectorProvider(buildVector(1)), llmProvider: invalidProvider }),
    ).rejects.toBeInstanceOf(GenerationError);
  });
});
