import { listJobs } from "@/db/queries";
import { completeJson } from "@/generation/llm";
import { parseAnalysisResponse, parseBestMatchResponse } from "@/generation/parse";
import { buildAnalysisPrompt, buildBestMatchPrompt } from "@/generation/prompt";
import {
  calculateWeightedScore,
  type BestMatchResult,
  type CareerAnalysis,
  type CareerAnalysisSource,
} from "@/generation/types";
import {
  retrieveCareerEvidence,
  type CareerEvidenceItem,
  type RetrievalTarget,
} from "@/services/retrieval";

/**
 * Analysis service: retrieve evidence, call Groq, attach sources.
 *
 * The LLM never sees the raw database and never computes the Best Match
 * overall score. Retrieval decides the evidence; TypeScript decides the
 * weighted score; the model only writes grounded JSON from the chunks.
 */

/**
 * Fixed query used for every Best Match job. Using the same wording for
 * all four slots means score differences come from the *job evidence*,
 * not from a different question embedding per slot.
 */
const BEST_MATCH_QUERY =
  "Evaluate the candidate's overall fit for this job across technical skills, experience, domain, and seniority.";

/**
 * Strip chunk text before returning sources to the UI.
 * Citations need filename / type / job / index / similarity — not a second
 * copy of the prompt context.
 */
function toSource(item: CareerEvidenceItem): CareerAnalysisSource {
  return {
    filename: item.filename,
    documentType: item.documentType,
    jobId: item.jobId,
    chunkIndex: item.chunkIndex,
    similarity: item.similarity,
  };
}

/**
 * Answer one career question against a chosen job (or all jobs).
 *
 * Pipeline:
 *   retrieveCareerEvidence → buildAnalysisPrompt → Groq JSON → parse → attach sources
 *
 * `sources` is always taken from the retrieved chunks, never from the
 * model, so the UI cannot show a citation the retriever did not return.
 */
export async function analyzeCareerFit(input: {
  question: string;
  targetJobId: RetrievalTarget;
  topK?: number;
}): Promise<CareerAnalysis> {
  const evidence = await retrieveCareerEvidence({
    query: input.question,
    targetJobId: input.targetJobId,
    topK: input.topK,
  });
  if (evidence.length === 0) {
    throw new Error(
      "No evidence was retrieved. Upload a resume and at least one job description before asking questions.",
    );
  }

  const prompt = buildAnalysisPrompt(input.question, evidence);
  const modelOutput = parseAnalysisResponse(await completeJson(prompt.system, prompt.user));
  return { ...modelOutput, sources: evidence.map(toSource) };
}

/**
 * Score every uploaded job independently, then sort high → low.
 *
 * Isolation matters: each job gets its own retrieve + generate call with
 * `targetJobId = job.id`. That is what stops Job 2's requirements from
 * leaking into Job 1's score. A job with no JD chunks is skipped rather
 * than scored from resume-only evidence (which would look like a match).
 *
 * `calculateWeightedScore` runs in this process with fixed weights so the
 * model cannot inflate one overall number.
 */
export async function findBestMatch(): Promise<BestMatchResult[]> {
  const jobs = await listJobs();
  if (jobs.length === 0) {
    throw new Error(
      "No job descriptions have been uploaded yet. Upload at least one job before running Best Match.",
    );
  }

  const results: BestMatchResult[] = [];

  for (const job of jobs) {
    const evidence = await retrieveCareerEvidence({
      query: BEST_MATCH_QUERY,
      targetJobId: job.id,
    });
    if (!evidence.some((item) => item.documentType === "job_description")) {
      continue;
    }

    const prompt = buildBestMatchPrompt(evidence);
    const modelOutput = parseBestMatchResponse(await completeJson(prompt.system, prompt.user));
    results.push({
      ...modelOutput,
      jobId: job.id,
      jobSlot: job.slot,
      score: calculateWeightedScore(modelOutput.categoryScores),
      sources: evidence.map(toSource),
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
