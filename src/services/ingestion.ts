import { ingestDocument } from "@/rag/ingest";
import type {
  ChunkingConfig,
  IngestionDocumentMetadata,
  IngestionFile,
  IngestionResult,
} from "@/rag/types";

export type IngestUploadedDocumentInput = {
  file: IngestionFile;
  metadata: IngestionDocumentMetadata;
  chunking?: Partial<ChunkingConfig>;
};

export async function ingestUploadedDocument(
  input: IngestUploadedDocumentInput,
): Promise<IngestionResult> {
  return ingestDocument(input);
}
