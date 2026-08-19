import "server-only";

import { listJobs } from "@/db/repositories/jobs";
import { buildBestMatchPrompt } from "@/generation/best-match-prompt";
import type { BestMatchResult, ScoreCategory } from "@/generation/best-match-types";
import { GenerationError } from "@/generation/errors";
import { getDefaultAnalysisProvider } from "@/generation/groq-client";
import { parseBestMatchResponse } from "@/generation/parse-best-match";
import { calculateWeightedScore, DEFAULT_SCORE_WEIGHTS } from "@/generation/scoring";
import type { AnalysisLLMProvider, CareerAnalysisSource, GroundedPrompt } from "@/generation/types";
import {
  retrieveCareerEvidence,
  type CareerEvidenceItem,
  type RetrieveCareerEvidenceDependencies,
} from "@/services/retrieval";

const DEFAULT_BEST_MATCH_QUERY =
  "Evaluate the candidate's overall fit for this job across technical skills, experience, domain, and seniority.";

export type FindBestMatchDependencies = RetrieveCareerEvidenceDependencies & {
  llmProvider?: AnalysisLLMProvider;
  weights?: Record<ScoreCategory, number>;
  query?: string;
  topK?: number;
};

/**
 * Compares the resume against every uploaded job independently: one
 * retrieveCareerEvidence call and one LLM call per job, never all jobs in
 * a single prompt. Each job's final score is computed in application code
 * (see scoring.ts) from the model's per-category scores, then jobs are
 * ranked descending by that score.
 *
 * A job whose retrieval returns no evidence (no uploaded document/chunks
 * yet) is skipped rather than failing the whole comparison — "only compare
 * jobs that actually have uploaded documents".
 */
export async function findBestMatch(
  dependencies: FindBestMatchDependencies = {},
): Promise<BestMatchResult[]> {
  const jobs = await listJobs(dependencies.pool);

  if (jobs.length === 0) {
    throw new GenerationError(
      "No job descriptions have been uploaded yet. Upload at least one job before running Best Match.",
    );
  }

  const query = dependencies.query ?? DEFAULT_BEST_MATCH_QUERY;
  const llmProvider = dependencies.llmProvider ?? getDefaultAnalysisProvider();
  const weights = dependencies.weights ?? DEFAULT_SCORE_WEIGHTS;

  const results: BestMatchResult[] = [];

  for (const job of jobs) {
    const evidence = await retrieveCareerEvidence(
      { query, targetJobId: job.id, topK: dependencies.topK },
      dependencies,
    );

    // retrieveCareerEvidence always includes resume evidence regardless of
    // the job, so an empty overall list is not how a job with no uploaded
    // chunks shows up. Checking specifically for job_description evidence
    // detects that case (e.g. an interrupted upload) instead.
    const hasJobEvidence = evidence.some((item) => item.documentType === "job_description");
    if (!hasJobEvidence) {
      continue;
    }

    const prompt = buildBestMatchPrompt(evidence);
    const rawResponse = await callProvider(llmProvider, prompt);
    const modelOutput = parseBestMatchResponse(rawResponse);
    const score = calculateWeightedScore(modelOutput.categoryScores, weights);

    results.push({
      ...modelOutput,
      jobId: job.id,
      jobSlot: job.slot,
      score,
      sources: evidence.map(toSource),
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

async function callProvider(
  provider: AnalysisLLMProvider,
  prompt: GroundedPrompt,
): Promise<string> {
  try {
    return await provider.generate(prompt);
  } catch (error) {
    if (error instanceof GenerationError) {
      throw error;
    }
    throw new GenerationError("Groq generation failed", { cause: error });
  }
}

function toSource(item: CareerEvidenceItem): CareerAnalysisSource {
  return {
    filename: item.filename,
    documentType: item.documentType,
    jobId: item.jobId,
    chunkIndex: item.chunkIndex,
    similarity: item.similarity,
  };
}
