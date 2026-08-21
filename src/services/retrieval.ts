import { searchSimilarChunks } from "@/db/repositories/document-chunks";
import { embeddings } from "@/rag/embed";
import type { DocumentType } from "@/types/domain";

export type RetrievalTarget = string | "all";

export type CareerEvidenceItem = {
  content: string;
  similarity: number;
  documentType: DocumentType;
  jobId: string | null;
  filename: string | null;
  chunkIndex: number;
};

const DEFAULT_TOP_K = 5;

export async function retrieveCareerEvidence(input: {
  query: string;
  targetJobId: RetrievalTarget;
  topK?: number;
}): Promise<CareerEvidenceItem[]> {
  const query = input.query.trim();
  if (!query) {
    throw new Error("query must not be empty");
  }

  const topK = input.topK ?? DEFAULT_TOP_K;
  const queryEmbedding = await embeddings.embedQuery(query);
  const jobFilters =
    input.targetJobId === "all"
      ? { documentType: "job_description" as const }
      : { jobId: input.targetJobId };

  const [resumeMatches, jobMatches] = await Promise.all([
    searchSimilarChunks(queryEmbedding, { topK, filters: { documentType: "resume" } }),
    searchSimilarChunks(queryEmbedding, { topK, filters: jobFilters }),
  ]);

  return [...resumeMatches, ...jobMatches]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, topK)
    .map((row) => ({
      content: row.content,
      similarity: row.similarity,
      documentType: row.documentType,
      jobId: row.jobId,
      filename: typeof row.metadata.original_filename === "string" ? row.metadata.original_filename : null,
      chunkIndex: row.chunkIndex,
    }));
}
