import { startTimer } from "@/lib/observability/logger";
import { ingestDocument } from "@/rag/ingest";
import { logIngestionStats } from "@/rag/stats";
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
  /** Observability only — not attached to chunk metadata. */
  jobSlot?: number | null;
};

export async function ingestUploadedDocument(
  input: IngestUploadedDocumentInput,
): Promise<IngestionResult> {
  const elapsed = startTimer();
  const result = await ingestDocument(input);
  logIngestionStats(result.stats, {
    durationMs: elapsed(),
    jobId: input.metadata.jobId,
    jobSlot: input.jobSlot ?? null,
  });
  return result;
}
