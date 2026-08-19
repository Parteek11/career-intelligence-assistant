import "server-only";

import type { Pool } from "pg";
import {
  searchSimilarChunks,
  type VectorSearchFilters,
  type VectorSearchResult,
} from "@/db/repositories/document-chunks";
import { getDefaultEmbeddingProvider } from "@/rag/embedding/provider";
import type { EmbeddingProvider } from "@/rag/embedding/types";
import type { DocumentType } from "@/types/domain";

export class RetrievalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetrievalError";
  }
}

/** A specific job's database id, or "all" to search every uploaded job. */
export type RetrievalTarget = string | "all";

export type RetrieveCareerEvidenceInput = {
  query: string;
  targetJobId: RetrievalTarget;
  topK?: number;
};

export type CareerEvidenceItem = {
  content: string;
  similarity: number;
  documentType: DocumentType;
  jobId: string | null;
  filename: string | null;
  chunkIndex: number;
};

export type RetrieveCareerEvidenceDependencies = {
  provider?: EmbeddingProvider;
  pool?: Pool;
};

const DEFAULT_TOP_K = 5;

/**
 * Retrieves resume + job evidence for a career-fit question.
 *
 * The retrieval corpus is always "the resume" plus either one selected job
 * or every uploaded job. Job filtering happens in the same SQL query as the
 * vector search (see searchSimilarChunks), so a chunk from an unselected
 * job can never be returned — there is no cross-job contamination for a
 * specific-job query.
 *
 * This function only composes existing building blocks: it embeds the
 * query with the existing embedding provider and calls the existing
 * pgvector repository twice (resume corpus, job corpus). It does not write
 * SQL and does not know how vectors are produced or stored.
 */
export async function retrieveCareerEvidence(
  input: RetrieveCareerEvidenceInput,
  dependencies: RetrieveCareerEvidenceDependencies = {},
): Promise<CareerEvidenceItem[]> {
  const query = input.query.trim();
  if (!query) {
    throw new RetrievalError("query must not be empty");
  }

  const topK = input.topK ?? DEFAULT_TOP_K;
  if (!Number.isFinite(topK) || topK <= 0) {
    throw new RetrievalError("topK must be a positive number");
  }

  const provider = dependencies.provider ?? getDefaultEmbeddingProvider();
  const [queryEmbedding] = await provider.embed([query]);

  const jobFilters = buildJobFilters(input.targetJobId);

  const [resumeMatches, jobMatches] = await Promise.all([
    searchSimilarChunks(
      queryEmbedding,
      { topK, filters: { documentType: "resume" } },
      dependencies.pool,
    ),
    searchSimilarChunks(queryEmbedding, { topK, filters: jobFilters }, dependencies.pool),
  ]);

  const merged = mergeBySimilarity(resumeMatches, jobMatches, topK);

  return merged.map(toEvidenceItem);
}

function buildJobFilters(target: RetrievalTarget): VectorSearchFilters {
  if (target === "all") {
    return { documentType: "job_description" };
  }

  return { jobId: target };
}

/**
 * Each source query already ranks its own candidates in SQL via `<=>`.
 * Merging the two small, already-ranked result sets in JavaScript (instead
 * of concatenating raw table scans) preserves that ranking without
 * recomputing similarity outside Postgres.
 */
function mergeBySimilarity(
  resumeMatches: VectorSearchResult[],
  jobMatches: VectorSearchResult[],
  topK: number,
): VectorSearchResult[] {
  return [...resumeMatches, ...jobMatches]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, topK);
}

function toEvidenceItem(row: VectorSearchResult): CareerEvidenceItem {
  return {
    content: row.content,
    similarity: row.similarity,
    documentType: row.documentType,
    jobId: row.jobId,
    filename: readFilename(row.metadata),
    chunkIndex: row.chunkIndex,
  };
}

function readFilename(metadata: Record<string, unknown>): string | null {
  const value = metadata.original_filename;
  return typeof value === "string" ? value : null;
}
