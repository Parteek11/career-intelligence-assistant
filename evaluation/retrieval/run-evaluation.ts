/**
 * CLI entry for retrieval evaluation.
 *
 * Flow:
 *   1. Load `.env` and the golden-questions JSON.
 *   2. Seed the golden resume + 4 JDs through the real upload services
 *      (this overwrites whatever is currently in the database).
 *   3. Run each question through `retrieveCareerEvidence`.
 *   4. Write `evaluation/results/latest.json` plus a timestamped copy.
 *   5. `clearAll()` so the user's previous uploads are not left replaced
 *      by the golden corpus.
 *   6. Close the pg pool so the process can exit.
 *
 * Run with `npm run eval:retrieval`. Requires `DATABASE_URL`.
 */

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

/**
 * Persist the report twice: a timestamped snapshot for history, and
 * `latest.json` so docs / CI can always point at one stable path.
 */
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

/** Human-readable per-question + aggregate dump for the terminal. */
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

/**
 * Seed → retrieve → score → write → clean up.
 *
 * `configuration` is stored on the report so a later change to chunk
 * size, overlap, top-K, or the embedding model is visible next to the
 * numbers it produced.
 */
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
    // The pool keeps the event loop alive until we end it.
    await getPool().end();
  });
