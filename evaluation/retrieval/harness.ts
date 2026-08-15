/**
 * Shared evaluation harness. Used by the default retrieval eval and the
 * isolated chunking experiment. Does not change production retrieval.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { getJobBySlot } from "@/db/repositories/jobs";
import type { ChunkingConfig } from "@/rag/types";
import { uploadJobDescription, uploadResume } from "@/services/document-management";
import { retrieveCareerEvidence } from "@/services/retrieval";

import { GOLDEN_JOBS, GOLDEN_RESUME } from "./golden-corpus";
import { average, averageDefined, computeLabeledMetrics } from "./metrics";
import type {
  EvaluationReport,
  GoldenCase,
  LogicalJobId,
  QuestionResult,
} from "./types";

export const EMBEDDING_MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
export const TOP_K = 5;

const currentDir = dirname(fileURLToPath(import.meta.url));
const datasetPath = join(currentDir, "../datasets/golden-questions.json");
const projectRoot = join(currentDir, "../..");

export function loadProjectEnv(): void {
  const envPath = join(projectRoot, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadDataset(): GoldenCase[] {
  const raw = readFileSync(datasetPath, "utf8");
  return JSON.parse(raw) as GoldenCase[];
}

export type SeededCorpus = {
  jobIdByLogicalId: Record<LogicalJobId, string>;
  relevantChunkCounts: {
    resume: number;
    jobs: Record<LogicalJobId, number>;
  };
};

export async function seedGoldenCorpus(
  chunking?: Partial<ChunkingConfig>,
): Promise<SeededCorpus> {
  const resumeSummary = await uploadResume(
    {
      buffer: Buffer.from(GOLDEN_RESUME.content),
      filename: GOLDEN_RESUME.filename,
      mimeType: "text/plain",
    },
    { chunking },
  );

  const jobIdByLogicalId = {} as Record<LogicalJobId, string>;
  const jobChunkCounts = {} as Record<LogicalJobId, number>;

  for (const [logicalId, job] of Object.entries(GOLDEN_JOBS) as [
    LogicalJobId,
    (typeof GOLDEN_JOBS)[LogicalJobId],
  ][]) {
    const summary = await uploadJobDescription(
      job.slot,
      {
        buffer: Buffer.from(job.content),
        filename: job.filename,
        mimeType: "text/plain",
      },
      { chunking },
    );

    const jobRow = await getJobBySlot(job.slot);
    if (!jobRow) {
      throw new Error(`Failed to seed golden job for slot ${job.slot}`);
    }

    jobIdByLogicalId[logicalId] = jobRow.id;
    jobChunkCounts[logicalId] = summary.chunkCount;
  }

  return {
    jobIdByLogicalId,
    relevantChunkCounts: { resume: resumeSummary.chunkCount, jobs: jobChunkCounts },
  };
}

function resolveTargetJobId(
  target: GoldenCase["targetJobId"],
  jobIdByLogicalId: Record<LogicalJobId, string>,
): string | "all" {
  if (target === "all") {
    return "all";
  }

  const jobId = jobIdByLogicalId[target];
  if (!jobId) {
    throw new Error(`Golden dataset references unknown logical job id: ${target}`);
  }

  return jobId;
}

function resolveExpectedJobIds(
  expectedJobIds: LogicalJobId[],
  jobIdByLogicalId: Record<LogicalJobId, string>,
): Set<string> {
  return new Set(expectedJobIds.map((logicalId) => jobIdByLogicalId[logicalId]));
}

function countTotalRelevant(
  testCase: GoldenCase,
  relevantChunkCounts: SeededCorpus["relevantChunkCounts"],
): number {
  let total = 0;

  if (testCase.expectedDocumentTypes.includes("resume")) {
    total += relevantChunkCounts.resume;
  }

  if (testCase.expectedDocumentTypes.includes("job_description")) {
    for (const logicalId of testCase.expectedJobIds) {
      total += relevantChunkCounts.jobs[logicalId] ?? 0;
    }
  }

  return total;
}

export async function runQuestion(
  testCase: GoldenCase,
  corpus: SeededCorpus,
  topK: number = TOP_K,
): Promise<QuestionResult> {
  const resolvedTarget = resolveTargetJobId(testCase.targetJobId, corpus.jobIdByLogicalId);
  const expectedJobIdSet = resolveExpectedJobIds(testCase.expectedJobIds, corpus.jobIdByLogicalId);

  const start = performance.now();
  const evidence = await retrieveCareerEvidence({
    query: testCase.question,
    targetJobId: resolvedTarget,
    topK,
  });
  const latencyMs = performance.now() - start;

  const totalRelevant = countTotalRelevant(testCase, corpus.relevantChunkCounts);

  return {
    id: testCase.id,
    question: testCase.question,
    targetJobId: testCase.targetJobId,
    topK,
    latencyMs: Math.round(latencyMs * 100) / 100,
    retrieved: evidence.map((item) => ({
      documentType: item.documentType,
      jobId: item.jobId,
      filename: item.filename,
      chunkIndex: item.chunkIndex,
      similarity: item.similarity,
    })),
    metrics: computeLabeledMetrics({
      isAllJobsQuery: testCase.targetJobId === "all",
      retrieved: evidence,
      expectedDocumentTypes: testCase.expectedDocumentTypes,
      expectedJobIds: expectedJobIdSet,
      expectedConcepts: testCase.expectedConcepts,
      totalRelevantAvailable: totalRelevant,
    }),
  };
}

export async function runDataset(
  dataset: GoldenCase[],
  corpus: SeededCorpus,
  topK: number = TOP_K,
): Promise<QuestionResult[]> {
  const perQuestion: QuestionResult[] = [];
  for (const testCase of dataset) {
    perQuestion.push(await runQuestion(testCase, corpus, topK));
  }
  return perQuestion;
}

export function buildAggregate(perQuestion: QuestionResult[]): EvaluationReport["aggregate"] {
  return {
    precisionAtK: average(perQuestion.map((q) => q.metrics.precisionAtK)),
    recallAtK: average(perQuestion.map((q) => q.metrics.recallAtK)),
    conceptHitRate: average(perQuestion.map((q) => q.metrics.conceptHitRate)),
    jobFilterAccuracy: averageDefined(perQuestion.map((q) => q.metrics.jobFilterAccuracy)),
    jobCoverage: averageDefined(perQuestion.map((q) => q.metrics.jobCoverage)),
    averageLatencyMs: average(perQuestion.map((q) => q.latencyMs)),
  };
}

export function formatOptionalMetric(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}
