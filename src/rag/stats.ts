import type { Document } from "@langchain/core/documents";
import type { DocumentType } from "@/types/domain";
import type { IngestionStats } from "@/rag/types";

export function buildIngestionStats(input: {
  sourceFilename: string;
  documentType: DocumentType;
  pageCount: number | null;
  chunks: Document[];
}): IngestionStats {
  const lengths = input.chunks.map((chunk) => chunk.pageContent.length);
  const chunkCount = lengths.length;
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);

  return {
    sourceFilename: input.sourceFilename,
    documentType: input.documentType,
    pageCount: input.pageCount,
    chunkCount,
    averageChunkLength: chunkCount === 0 ? 0 : Math.round(totalLength / chunkCount),
    minChunkLength: chunkCount === 0 ? 0 : Math.min(...lengths),
    maxChunkLength: chunkCount === 0 ? 0 : Math.max(...lengths),
  };
}
