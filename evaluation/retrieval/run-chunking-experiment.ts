// Isolated chunking experiment. Re-seeds the golden corpus at each
// (chunkSize, chunkOverlap) pair, runs the same golden questions through
// unmodified retrieveCareerEvidence, and writes a compact comparison.
//
// Does not change production DEFAULT_CHUNK_SIZE / DEFAULT_CHUNK_OVERLAP.
//
// Run with: npm run eval:chunking

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getPool } from "@/db/pool";
import { clearAll } from "@/services/document-management";

import { buildChunkingExperimentReport, CHUNKING_EXPERIMENT_CONFIGS } from "./chunking-experiment";
import {
  EMBEDDING_MODEL_NAME,
  TOP_K,
  buildAggregate,
  loadDataset,
  loadProjectEnv,
  runDataset,
  seedGoldenCorpus,
} from "./harness";
import type { ChunkingExperimentConfigurationResult } from "./types";

const currentDir = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(currentDir, "../results");
const resultFile = join(resultsDir, "chunking-experiment.json");

async function main(): Promise<void> {
  loadProjectEnv();

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  }

  const dataset = loadDataset();
  const configurations: ChunkingExperimentConfigurationResult[] = [];

  for (const config of CHUNKING_EXPERIMENT_CONFIGS) {
    console.log(`\nEvaluating chunkSize=${config.chunkSize} overlap=${config.chunkOverlap}...`);
    await clearAll();
    const corpus = await seedGoldenCorpus(config);
    const perQuestion = await runDataset(dataset, corpus, TOP_K);
    const aggregate = buildAggregate(perQuestion);

    configurations.push({
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      precisionAt5: aggregate.precisionAtK,
      recallAt5: aggregate.recallAtK,
      conceptHitRate: aggregate.conceptHitRate,
      averageLatencyMs: aggregate.averageLatencyMs,
    });

    console.log(
      `  precision@5=${aggregate.precisionAtK.toFixed(3)} ` +
        `recall@5=${aggregate.recallAtK.toFixed(3)} ` +
        `conceptHitRate=${aggregate.conceptHitRate.toFixed(3)} ` +
        `avgLatency=${aggregate.averageLatencyMs.toFixed(1)}ms`,
    );
  }

  const report = buildChunkingExperimentReport({
    timestamp: new Date().toISOString(),
    datasetSize: dataset.length,
    topK: TOP_K,
    embeddingModel: EMBEDDING_MODEL_NAME,
    configurations,
  });

  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }
  writeFileSync(resultFile, JSON.stringify(report, null, 2));

  console.log(`\nChunking experiment written to ${resultFile}`);
  console.log("Production chunking defaults were not changed.");

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
