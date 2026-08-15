import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Document } from "@langchain/core/documents";
import { IngestionError } from "@/rag/errors";
import {
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  type ChunkingConfig,
} from "@/rag/types";

export function resolveChunkingConfig(
  config: Partial<ChunkingConfig> = {},
): ChunkingConfig {
  const chunkSize = config.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = config.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new IngestionError("chunkSize must be a number greater than 0");
  }

  if (!Number.isFinite(chunkOverlap) || chunkOverlap < 0) {
    throw new IngestionError("chunkOverlap must be a number of 0 or more");
  }

  if (chunkOverlap >= chunkSize) {
    throw new IngestionError("chunkOverlap must be smaller than chunkSize");
  }

  return { chunkSize, chunkOverlap };
}

export function createCharacterTextSplitter(
  config: ChunkingConfig,
): RecursiveCharacterTextSplitter {
  return new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  });
}

export async function splitDocuments(
  documents: Document[],
  config: ChunkingConfig,
): Promise<Document[]> {
  const splitter = createCharacterTextSplitter(config);
  return splitter.splitDocuments(documents);
}
