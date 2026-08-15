import type {
  ChunkingExperimentConfig,
  ChunkingExperimentConfigurationResult,
  ChunkingExperimentReport,
} from "./types";

export const CHUNKING_EXPERIMENT_CONFIGS: ChunkingExperimentConfig[] = [
  { chunkSize: 500, chunkOverlap: 75 },
  { chunkSize: 900, chunkOverlap: 120 },
  { chunkSize: 1200, chunkOverlap: 150 },
];

export function buildChunkingExperimentReport(input: {
  timestamp: string;
  datasetSize: number;
  topK: number;
  embeddingModel: string;
  configurations: ChunkingExperimentConfigurationResult[];
}): ChunkingExperimentReport {
  return {
    timestamp: input.timestamp,
    datasetSize: input.datasetSize,
    topK: input.topK,
    embeddingModel: input.embeddingModel,
    configurations: input.configurations.map((configuration) => ({
      chunkSize: configuration.chunkSize,
      chunkOverlap: configuration.chunkOverlap,
      precisionAt5: configuration.precisionAt5,
      recallAt5: configuration.recallAt5,
      conceptHitRate: configuration.conceptHitRate,
      averageLatencyMs: configuration.averageLatencyMs,
    })),
  };
}

export function isChunkingExperimentReport(value: unknown): value is ChunkingExperimentReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.timestamp !== "string" ||
    typeof record.datasetSize !== "number" ||
    typeof record.topK !== "number" ||
    typeof record.embeddingModel !== "string" ||
    !Array.isArray(record.configurations)
  ) {
    return false;
  }

  return record.configurations.every((item) => isConfigurationResult(item));
}

function isConfigurationResult(value: unknown): value is ChunkingExperimentConfigurationResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.chunkSize === "number" &&
    typeof record.chunkOverlap === "number" &&
    typeof record.precisionAt5 === "number" &&
    typeof record.recallAt5 === "number" &&
    typeof record.conceptHitRate === "number" &&
    typeof record.averageLatencyMs === "number"
  );
}
