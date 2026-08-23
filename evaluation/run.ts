/**
 * MVP evaluation runner.
 *
 *   1. Upload the golden PDFs (1 resume + 2 JDs) through the real ingest path.
 *   2. For each question: retrieve, then Ask (Groq) if GROQ_API_KEY is set.
 *   3. Score 5 metrics and write evaluation/results/latest.json.
 *   4. Clear the golden uploads so the user's documents are not left overwritten.
 *
 * Run: npm run eval
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getJobBySlot } from "@/db/queries";
import { getPool } from "@/db/pool";
import { askCareerQuestion } from "@/services/analysis";
import { clearAll, uploadJobDescription, uploadResume } from "@/services/documents";
import { retrieveCareerEvidence } from "@/services/retrieval";

import {
  answerCorrectness,
  answerRelevance,
  average,
  averageDefined,
  faithfulness,
  precisionAtK,
  recallAtK,
} from "./metrics";
import type {
  EvaluationReport,
  EvalTarget,
  GoldenCase,
  LogicalJobId,
  QuestionResult,
} from "./types";

export const TOP_K = 5;

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");
const resultsDir = join(here, "results");

const JOB_FILES: Record<LogicalJobId, { slot: 1 | 2; filename: string }> = {
  job_1: { slot: 1, filename: "job-1.pdf" },
  job_2: { slot: 2, filename: "job-2.pdf" },
};

function loadEnv(): void {
  const envPath = join(here, "../.env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function loadGolden(): GoldenCase[] {
  return JSON.parse(readFileSync(join(here, "golden.json"), "utf8")) as GoldenCase[];
}

type SeededCorpus = {
  jobIdByLogicalId: Record<LogicalJobId, string>;
  chunkCounts: { resume: number; jobs: Record<LogicalJobId, number> };
};

function readFixture(name: string): Buffer {
  return readFileSync(join(fixturesDir, name));
}

async function seedCorpus(): Promise<SeededCorpus> {
  const resume = await uploadResume({
    buffer: readFixture("resume.pdf"),
    filename: "resume.pdf",
    mimeType: "application/pdf",
  });

  const jobIdByLogicalId = {} as Record<LogicalJobId, string>;
  const jobChunkCounts = {} as Record<LogicalJobId, number>;

  for (const [logicalId, job] of Object.entries(JOB_FILES) as [LogicalJobId, (typeof JOB_FILES)[LogicalJobId]][]) {
    const uploaded = await uploadJobDescription(job.slot, {
      buffer: readFixture(job.filename),
      filename: job.filename,
      mimeType: "application/pdf",
    });
    const row = await getJobBySlot(job.slot);
    if (!row) throw new Error(`Failed to seed ${logicalId}`);
    jobIdByLogicalId[logicalId] = row.id;
    jobChunkCounts[logicalId] = uploaded.chunkCount;
  }

  return {
    jobIdByLogicalId,
    chunkCounts: { resume: resume.chunkCount, jobs: jobChunkCounts },
  };
}

function countRelevant(testCase: GoldenCase, corpus: SeededCorpus): number {
  let total = 0;
  if (testCase.expectedSources.includes("resume")) total += corpus.chunkCounts.resume;
  if (testCase.expectedSources.includes("job_description")) {
    for (const job of testCase.expectedJobs) {
      total += corpus.chunkCounts.jobs[job] ?? 0;
    }
  }
  return total;
}

function resolveTarget(target: EvalTarget, corpus: SeededCorpus): string | "all" {
  if (target === "all") return "all";
  const id = corpus.jobIdByLogicalId[target];
  if (!id) throw new Error(`Unknown target: ${target}`);
  return id;
}

function generatedText(answer: string, jobAnswers: { jobSlot: number; filename: string | null; answer: string }[]): string {
  if (jobAnswers.length > 0) {
    return jobAnswers.map((item) => `Job ${item.jobSlot}: ${item.answer}`).join("\n");
  }
  return answer;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function askWithRetry(question: string, targetJobId: string | "all") {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await askCareerQuestion({ question, targetJobId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("429") || attempt === 3) throw error;
      console.log(`    Groq rate limit — waiting 30s (attempt ${attempt}/3)...`);
      await sleep(30_000);
    }
  }
  throw new Error("Ask failed after retries");
}

async function runQuestion(testCase: GoldenCase, corpus: SeededCorpus, canGenerate: boolean): Promise<QuestionResult> {
  const targetJobId = resolveTarget(testCase.target, corpus);
  const expectedJobIds = new Set(testCase.expectedJobs.map((job) => corpus.jobIdByLogicalId[job]));

  const evidence = await retrieveCareerEvidence({
    query: testCase.question,
    targetJobId,
    topK: TOP_K,
  });

  const retrieval = {
    precisionAtK: precisionAtK(evidence, testCase.expectedSources, expectedJobIds),
    recallAtK: recallAtK(evidence, testCase.expectedSources, expectedJobIds, countRelevant(testCase, corpus), TOP_K),
  };

  let generatedAnswer: string | null = null;
  let generation: QuestionResult["generation"] = null;

  if (canGenerate) {
    const result = await askWithRetry(testCase.question, targetJobId);
    generatedAnswer = generatedText(result.answer, result.jobAnswers);
    const evidenceText = evidence.map((item) => item.content).join("\n");
    generation = {
      faithfulness: faithfulness(generatedAnswer, evidenceText),
      answerRelevance: answerRelevance(testCase.question, generatedAnswer),
      answerCorrectness: answerCorrectness(testCase.referenceAnswer, generatedAnswer),
    };
  }

  return {
    id: testCase.id,
    question: testCase.question,
    target: testCase.target,
    retrieved: evidence.map((item) => ({
      documentType: item.documentType,
      jobId: item.jobId,
      filename: item.filename,
      chunkIndex: item.chunkIndex,
      similarity: item.similarity,
    })),
    generatedAnswer,
    retrieval,
    generation,
  };
}

function writeReport(report: EvaluationReport): string {
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const latestFile = join(resultsDir, "latest.json");
  writeFileSync(latestFile, JSON.stringify(report, null, 2));
  return latestFile;
}

function printSummary(report: EvaluationReport, resultFile: string): void {
  console.log("\nPer-question results:");
  for (const item of report.perQuestion) {
    const g = item.generation;
    const gen =
      g === null
        ? "generation=skipped (no GROQ_API_KEY)"
        : `faithfulness=${g.faithfulness.toFixed(2)} relevance=${g.answerRelevance.toFixed(2)} correctness=${g.answerCorrectness.toFixed(2)}`;
    console.log(
      `  ${item.id}: precision=${item.retrieval.precisionAtK.toFixed(2)} recall=${item.retrieval.recallAtK.toFixed(2)} ${gen}`,
    );
  }

  const a = report.aggregate;
  console.log("\nAggregate (5 metrics):");
  console.log(`  Precision@${TOP_K}:        ${a.precisionAtK.toFixed(3)}`);
  console.log(`  Recall@${TOP_K}:           ${a.recallAtK.toFixed(3)}`);
  console.log(`  Faithfulness:       ${a.faithfulness === null ? "n/a" : a.faithfulness.toFixed(3)}`);
  console.log(`  Answer relevance:   ${a.answerRelevance === null ? "n/a" : a.answerRelevance.toFixed(3)}`);
  console.log(`  Answer correctness: ${a.answerCorrectness === null ? "n/a" : a.answerCorrectness.toFixed(3)}`);
  console.log(`\nResults written to ${resultFile}`);
}

async function main(): Promise<void> {
  loadEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  }

  const canGenerate = Boolean(process.env.GROQ_API_KEY?.trim());
  if (!canGenerate) {
    console.log("GROQ_API_KEY is not set. Retrieval metrics will run; generation metrics will be skipped.");
  }

  const dataset = loadGolden();
  console.log(`Seeding golden PDFs for ${dataset.length} questions...`);
  const corpus = await seedCorpus();

  try {
    const perQuestion: QuestionResult[] = [];
    for (const testCase of dataset) {
      console.log(`  Running ${testCase.id}...`);
      perQuestion.push(await runQuestion(testCase, corpus, canGenerate));
    }

    const report: EvaluationReport = {
      timestamp: new Date().toISOString(),
      datasetSize: dataset.length,
      topK: TOP_K,
      perQuestion,
      aggregate: {
        precisionAtK: average(perQuestion.map((q) => q.retrieval.precisionAtK)),
        recallAtK: average(perQuestion.map((q) => q.retrieval.recallAtK)),
        faithfulness: averageDefined(perQuestion.map((q) => q.generation?.faithfulness ?? null)),
        answerRelevance: averageDefined(perQuestion.map((q) => q.generation?.answerRelevance ?? null)),
        answerCorrectness: averageDefined(perQuestion.map((q) => q.generation?.answerCorrectness ?? null)),
      },
    };

    const resultFile = writeReport(report);
    printSummary(report, resultFile);
  } finally {
    console.log("\nCleaning up golden corpus...");
    await clearAll();
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
