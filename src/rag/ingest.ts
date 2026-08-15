import { Document } from "@langchain/core/documents";
import { resolveChunkingConfig, splitDocuments } from "@/rag/chunking";
import { IngestionError } from "@/rag/errors";
import { loadSourceDocuments } from "@/rag/load";
import { enrichChunkMetadata, validateIngestionMetadata } from "@/rag/metadata";
import { normalizeDocumentText } from "@/rag/normalize";
import { buildIngestionStats } from "@/rag/stats";
import type {
  ChunkingConfig,
  IngestionDocumentMetadata,
  IngestionFile,
  IngestionResult,
} from "@/rag/types";

export async function ingestDocument(input: {
  file: IngestionFile;
  metadata: IngestionDocumentMetadata;
  chunking?: Partial<ChunkingConfig>;
}): Promise<IngestionResult> {
  assertIngestionFile(input.file);
  validateIngestionMetadata(input.metadata);

  if (input.file.buffer.length === 0) {
    return emptyResult(input);
  }

  const chunking = resolveChunkingConfig(input.chunking);
  const loaded = await loadSourceDocuments(input.file);
  const normalized = loaded.documents
    .map(
      (document) =>
        new Document({
          pageContent: normalizeDocumentText(document.pageContent),
          metadata: document.metadata,
        }),
    )
    .filter((document) => document.pageContent.length > 0);

  if (normalized.length === 0) {
    return emptyResult(input, loaded.pageCount);
  }

  const split = await splitDocuments(normalized, chunking);
  const chunks = enrichChunkMetadata(split, input.metadata);

  return {
    chunks,
    stats: buildIngestionStats({
      sourceFilename: input.metadata.originalFilename,
      documentType: input.metadata.documentType,
      pageCount: loaded.pageCount,
      chunks,
    }),
  };
}

function emptyResult(
  input: {
    file: IngestionFile;
    metadata: IngestionDocumentMetadata;
  },
  pageCount: number | null = null,
): IngestionResult {
  return {
    chunks: [],
    stats: buildIngestionStats({
      sourceFilename: input.metadata.originalFilename,
      documentType: input.metadata.documentType,
      pageCount,
      chunks: [],
    }),
  };
}

export function assertIngestionFile(file: IngestionFile): void {
  if (!file.filename.trim()) {
    throw new IngestionError("A filename is required for ingestion");
  }
}
