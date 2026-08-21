// Seeds a golden resume + 4 jobs, runs questions through retrieveCareerEvidence,
// writes evaluation/results/latest.json, then clears the seeded data.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getPool } from "@/db/pool";
import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE } from "@/rag/ingest";
import { clearAll } from "@/services/documents";

import {
  EMBEDDING_MODEL_NAME,
  TOP_K,
  buildAggregate,
  formatOptionalMetric,
  loadDataset,
  loadProjectEnv,
  runDataset,
  seedGoldenCorpus,
} from "./harness";
import type { EvaluationReport } from "./types";

const currentDir = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(currentDir, "../results");

function writeReport(report: EvaluationReport): string {
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const timestampedFile = join(resultsDir, `retrieval-eval-${Date.now()}.json`);
  const latestFile = join(resultsDir, "latest.json");
  const json = JSON.stringify(report, null, 2);

  writeFileSync(timestampedFile, json);
  writeFileSync(latestFile, json);

  return timestampedFile;
}

function printSummary(report: EvaluationReport, resultFile: string): void {
  console.log("\nPer-question results:");
  for (const question of report.perQuestion) {
    const m = question.metrics;
    const scope = question.targetJobId === "all" ? "all-jobs" : "specific-job";
    console.log(
      `  ${question.id} [${scope}]: precision=${m.precisionAtK.toFixed(2)} recall=${m.recallAtK.toFixed(2)} ` +
        `jobFilterAccuracy=${formatOptionalMetric(m.jobFilterAccuracy)} ` +
        `jobCoverage=${formatOptionalMetric(m.jobCoverage)} ` +
        `conceptHitRate=${m.conceptHitRate.toFixed(2)} ` +
        `(${question.latencyMs.toFixed(1)}ms)`,
    );
  }

  console.log("\nAggregate metrics:");
  console.log(`  Precision@${TOP_K}: ${report.aggregate.precisionAtK.toFixed(3)}`);
  console.log(`  Recall@${TOP_K}: ${report.aggregate.recallAtK.toFixed(3)}`);
  console.log(
    `  Job-filter accuracy (specific-job queries): ${formatOptionalMetric(report.aggregate.jobFilterAccuracy)}`,
  );
  console.log(`  Job coverage (All Jobs queries): ${formatOptionalMetric(report.aggregate.jobCoverage)}`);
  console.log(`  Concept hit rate: ${report.aggregate.conceptHitRate.toFixed(3)}`);
  console.log(`  Average latency: ${report.aggregate.averageLatencyMs.toFixed(1)}ms`);
  console.log(`\nResults written to ${resultFile}`);
}

async function main(): Promise<void> {
  loadProjectEnv();

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  }

  const dataset = loadDataset();
  console.log(`Seeding golden corpus for ${dataset.length} golden questions...`);
  const corpus = await seedGoldenCorpus();

  const perQuestion = await runDataset(dataset, corpus);

  const configuration = {
    topK: TOP_K,
    embeddingModel: EMBEDDING_MODEL_NAME,
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
  };

  const report: EvaluationReport = {
    timestamp: new Date().toISOString(),
    datasetSize: dataset.length,
    configuration,
    perQuestion,
    aggregate: buildAggregate(perQuestion),
  };

  const resultFile = writeReport(report);
  printSummary(report, resultFile);

  console.log("\nCleaning up golden corpus...");
  await clearAll();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
