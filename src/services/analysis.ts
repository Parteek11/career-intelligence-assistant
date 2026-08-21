import { listJobs } from "@/db/repositories/jobs";
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

const BEST_MATCH_QUERY =
  "Evaluate the candidate's overall fit for this job across technical skills, experience, domain, and seniority.";

function toSource(item: CareerEvidenceItem): CareerAnalysisSource {
  return {
    filename: item.filename,
    documentType: item.documentType,
    jobId: item.jobId,
    chunkIndex: item.chunkIndex,
    similarity: item.similarity,
  };
}

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
