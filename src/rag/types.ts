import type { Document } from "@langchain/core/documents";
import type { DocumentType } from "@/types/domain";

export const DEFAULT_CHUNK_SIZE = 900;
export const DEFAULT_CHUNK_OVERLAP = 120;

export type ChunkingConfig = {
  chunkSize: number;
  chunkOverlap: number;
};

export type IngestionFile = {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
};

export type IngestionDocumentMetadata = {
  documentId: string;
  documentType: DocumentType;
  jobId: string | null;
  originalFilename: string;
};

export type IngestionStats = {
  sourceFilename: string;
  documentType: DocumentType;
  pageCount: number | null;
  chunkCount: number;
  averageChunkLength: number;
  minChunkLength: number;
  maxChunkLength: number;
};

export type IngestionResult = {
  chunks: Document[];
  stats: IngestionStats;
};
