export { ingestDocument } from "@/rag/ingest";
export { IngestionError } from "@/rag/errors";
export {
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
} from "@/rag/types";
export type {
  ChunkingConfig,
  IngestionDocumentMetadata,
  IngestionFile,
  IngestionResult,
  IngestionStats,
} from "@/rag/types";

export {
  embedChunks,
  EMBEDDING_DIMENSIONS,
  getDefaultEmbeddingProvider,
  TransformersEmbeddingProvider,
} from "@/rag/embedding";
export type { EmbeddedChunk, EmbeddingProvider } from "@/rag/embedding";
