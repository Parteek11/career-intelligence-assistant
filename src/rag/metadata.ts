import { Document } from "@langchain/core/documents";
import { IngestionError } from "@/rag/errors";
import type { IngestionDocumentMetadata } from "@/rag/types";

export function validateIngestionMetadata(
  metadata: IngestionDocumentMetadata,
): void {
  if (metadata.documentType === "resume" && metadata.jobId !== null) {
    throw new IngestionError("Resume chunks must have job_id = null");
  }

  if (metadata.documentType === "job_description" && !metadata.jobId) {
    throw new IngestionError("Job description chunks require a job_id");
  }
}

export function enrichChunkMetadata(
  chunks: Document[],
  metadata: IngestionDocumentMetadata,
): Document[] {
  return chunks.map((chunk, chunkIndex) => {
    const pageNumber = extractPageNumber(chunk.metadata);
    const source = readString(chunk.metadata.source);

    return new Document({
      pageContent: chunk.pageContent,
      metadata: {
        document_id: metadata.documentId,
        document_type: metadata.documentType,
        job_id: metadata.jobId,
        original_filename: metadata.originalFilename,
        chunk_index: chunkIndex,
        ...(pageNumber !== undefined ? { page_number: pageNumber } : {}),
        ...(source ? { source } : {}),
      },
    });
  });
}

function extractPageNumber(
  metadata: Record<string, unknown>,
): number | undefined {
  const loc = metadata.loc;
  if (isRecord(loc) && typeof loc.pageNumber === "number") {
    return loc.pageNumber;
  }

  if (typeof metadata.pageNumber === "number") {
    return metadata.pageNumber;
  }

  if (typeof metadata.page === "number") {
    return metadata.page;
  }

  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
