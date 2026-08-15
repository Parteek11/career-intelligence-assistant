import "server-only";

import { GenerationError } from "@/generation/errors";
import { getDefaultAnalysisProvider } from "@/generation/groq-client";
import { parseAnalysisResponse } from "@/generation/parse-analysis";
import { buildGroundedPrompt } from "@/generation/prompt";
import type { AnalysisLLMProvider, CareerAnalysis, CareerAnalysisSource } from "@/generation/types";
import { createQueryId, logGenerationEvent, startTimer } from "@/lib/observability/logger";
import {
  retrieveCareerEvidence,
  type CareerEvidenceItem,
  type RetrievalTarget,
  type RetrieveCareerEvidenceDependencies,
} from "@/services/retrieval";

export type AnalyzeCareerFitInput = {
  question: string;
  targetJobId: RetrievalTarget;
  topK?: number;
  queryId?: string;
};

export type AnalyzeCareerFitDependencies = RetrieveCareerEvidenceDependencies & {
  llmProvider?: AnalysisLLMProvider;
};

/**
 * Full generation flow: question -> retrieveCareerEvidence -> grounded
 * prompt -> Groq -> validated CareerAnalysis. Source references are built
 * directly from the retrieved evidence, never from the model's output, so
 * citations always point at real chunks.
 */
export async function analyzeCareerFit(
  input: AnalyzeCareerFitInput,
  dependencies: AnalyzeCareerFitDependencies = {},
): Promise<CareerAnalysis> {
  const queryId = input.queryId ?? createQueryId();
  const evidence = await retrieveCareerEvidence(
    {
      query: input.question,
      targetJobId: input.targetJobId,
      topK: input.topK,
      queryId,
    },
    dependencies,
  );

  if (evidence.length === 0) {
    throw new GenerationError(
      "No evidence was retrieved for this question and job selection. Upload a resume and at least one job description before asking questions.",
    );
  }

  const prompt = buildGroundedPrompt(input.question, evidence);
  const llmProvider = dependencies.llmProvider ?? getDefaultAnalysisProvider();
  const elapsed = startTimer();
  let success = false;

  try {
    const rawResponse = await callProvider(llmProvider, prompt);
    const modelOutput = parseAnalysisResponse(rawResponse);
    success = true;

    return {
      ...modelOutput,
      sources: evidence.map(toSource),
    };
  } finally {
    logGenerationEvent({
      queryId,
      selectedJob: input.targetJobId,
      retrievedResultCount: evidence.length,
      durationMs: elapsed(),
      success,
      model: llmProvider.model,
      ...llmProvider.lastUsage,
    });
  }
}

async function callProvider(
  provider: AnalysisLLMProvider,
  prompt: { system: string; user: string },
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
