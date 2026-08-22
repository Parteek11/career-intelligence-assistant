import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { getJobBySlot } from "@/db/queries";
import { uploadJobDescription, uploadResume } from "@/services/documents";
import { retrieveCareerEvidence } from "@/services/retrieval";

import { GOLDEN_JOBS, GOLDEN_RESUME } from "./golden-corpus";
import { average, averageDefined, computeLabeledMetrics } from "./metrics";
import type { EvaluationReport, GoldenCase, LogicalJobId, QuestionResult } from "./types";

/**
 * Retrieval evaluation harness.
 *
 * This file does **not** reimplement search. It seeds a known corpus
 * through the same `uploadResume` / `uploadJobDescription` services the
 * app uses, then calls `retrieveCareerEvidence` for each golden question.
 * That is the point: we measure the production retrieval path, not a
 * parallel test-only implementation.
 *
 * Logical ids (`job_1` … `job_4`) in the JSON dataset are mapped to the
 * UUIDs Postgres assigned at seed time. Metrics then compare retrieved
 * `jobId`s against those UUIDs.
 */

export const EMBEDDING_MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
/** Top-K used for every golden question. Matches a typical Analyze request. */
export const TOP_K = 5;

const currentDir = dirname(fileURLToPath(import.meta.url));
const datasetPath = join(currentDir, "../datasets/golden-questions.json");
const projectRoot = join(currentDir, "../..");

/**
 * Load `.env` into `process.env` without overwriting values already set
 * (so `DATABASE_URL=… npm run eval:retrieval` still wins). The eval
 * script is a standalone Node process, not Next.js, so it does not get
 * Next's automatic env loading.
 */
export function loadProjectEnv(): void {
  const envPath = join(projectRoot, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Read the labeled golden questions. Each case is one retrieval probe. */
export function loadDataset(): GoldenCase[] {
  return JSON.parse(readFileSync(datasetPath, "utf8")) as GoldenCase[];
}

/**
 * After seeding we need two maps:
 * - `jobIdByLogicalId` — JSON `job_1` → the UUID retrieval will return
 * - `relevantChunkCounts` — how many chunks exist per source, used as
 *   the denominator for Recall@K (true corpus size, not a guess)
 */
export type SeededCorpus = {
  jobIdByLogicalId: Record<LogicalJobId, string>;
  relevantChunkCounts: {
    resume: number;
    jobs: Record<LogicalJobId, number>;
  };
};

/**
 * Upload the golden resume + four JDs through the real ingest path.
 *
 * This overwrites whatever the user currently has in the database (same
 * single-resume / slot-1–4 model as the UI). `run-evaluation.ts` calls
 * `clearAll()` when finished. Chunk counts are recorded here because
 * recall needs "how many relevant chunks exist", and that number depends
 * on the live splitter settings (`DEFAULT_CHUNK_SIZE` / overlap).
 */
export async function seedGoldenCorpus(): Promise<SeededCorpus> {
  const resumeSummary = await uploadResume({
    buffer: Buffer.from(GOLDEN_RESUME.content),
    filename: GOLDEN_RESUME.filename,
    mimeType: "text/plain",
  });

  const jobIdByLogicalId = {} as Record<LogicalJobId, string>;
  const jobChunkCounts = {} as Record<LogicalJobId, number>;

  for (const [logicalId, job] of Object.entries(GOLDEN_JOBS) as [
    LogicalJobId,
    (typeof GOLDEN_JOBS)[LogicalJobId],
  ][]) {
    const summary = await uploadJobDescription(job.slot, {
      buffer: Buffer.from(job.content),
      filename: job.filename,
      mimeType: "text/plain",
    });
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

/**
 * Run one golden question through production retrieval and score it.
 *
 * `targetJobId: "all"` is passed through as-is. Any other logical id is
 * translated to the seeded UUID so `retrieveCareerEvidence` applies the
 * same job filter the UI would. `totalRelevant` is the count of chunks
 * that *should* be acceptable for this question (resume and/or the
 * expected jobs) — that is Recall@K's denominator.
 */
export async function runQuestion(
  testCase: GoldenCase,
  corpus: SeededCorpus,
  topK: number = TOP_K,
): Promise<QuestionResult> {
  const targetJobId =
    testCase.targetJobId === "all" ? "all" : corpus.jobIdByLogicalId[testCase.targetJobId];
  if (!targetJobId) {
    throw new Error(`Unknown logical job id: ${testCase.targetJobId}`);
  }

  const expectedJobIds = new Set(
    testCase.expectedJobIds.map((logicalId) => corpus.jobIdByLogicalId[logicalId]),
  );

  const start = performance.now();
  const evidence = await retrieveCareerEvidence({
    query: testCase.question,
    targetJobId,
    topK,
  });

  let totalRelevant = 0;
  if (testCase.expectedDocumentTypes.includes("resume")) {
    totalRelevant += corpus.relevantChunkCounts.resume;
  }
  if (testCase.expectedDocumentTypes.includes("job_description")) {
    for (const logicalId of testCase.expectedJobIds) {
      totalRelevant += corpus.relevantChunkCounts.jobs[logicalId] ?? 0;
    }
  }

  return {
    id: testCase.id,
    question: testCase.question,
    targetJobId: testCase.targetJobId,
    topK,
    latencyMs: Math.round((performance.now() - start) * 100) / 100,
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
      expectedJobIds,
      expectedConcepts: testCase.expectedConcepts,
      totalRelevantAvailable: totalRelevant,
    }),
  };
}

/** Run every golden question sequentially. Order matches the JSON file. */
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

/**
 * Macro-average each metric across questions.
 * `jobFilterAccuracy` / `jobCoverage` are null on the questions they do
 * not apply to, so we use `averageDefined` and skip those nulls.
 */
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

/** Format a nullable metric for the console summary (`null` → `"n/a"`). */
export function formatOptionalMetric(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}
