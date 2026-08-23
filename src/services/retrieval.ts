import { searchSimilarChunks, type SimilarChunk } from "@/db/queries";
import { embeddings } from "@/rag/embed";
import type { DocumentType } from "@/types/domain";

/**
 * Retrieval service: embed the user's question and pull the nearest resume
 * + job-description chunks from pgvector. This is the only place the app
 * decides *which* chunks the LLM is allowed to see.
 *
 * `targetJobId` is either a concrete job UUID (Analyze / Best Match for
 * one slot) or `"all"` (compare across every uploaded JD). Resume chunks
 * are always included — they have `job_id = null` and would be dropped by
 * a job-only filter.
 */
export type RetrievalTarget = string | "all";

/** One retrieved chunk, already mapped from the DB row into UI/LLM fields. */
export type CareerEvidenceItem = {
  content: string;
  similarity: number;
  documentType: DocumentType;
  jobId: string | null;
  filename: string | null;
  chunkIndex: number;
};

/** Default number of chunks handed to the prompt after the merge step. */
const DEFAULT_TOP_K = 10;

function chunkKey(row: SimilarChunk): string {
  return `${row.documentType}:${row.jobId ?? "resume"}:${row.chunkIndex}`;
}

/**
 * Keep both resume and JD in the prompt.
 *
 * Two searches already fetch `topK` from each side. A later global
 * `slice(0, topK)` still lets a long, query-similar JD take every slot
 * (Job 2 Best Match: 10 JD chunks, 0 resume, scores of 0). Reserve half
 * the budget for each source, then fill any leftover slots by distance.
 */
function mergeWithSourceQuota(
  resumeMatches: SimilarChunk[],
  jobMatches: SimilarChunk[],
  topK: number,
): SimilarChunk[] {
  const resumeQuota = Math.max(1, Math.ceil(topK / 2));
  const jobQuota = Math.max(1, topK - resumeQuota);
  const reserved = [...resumeMatches.slice(0, resumeQuota), ...jobMatches.slice(0, jobQuota)];
  const taken = new Set(reserved.map(chunkKey));
  const leftovers = [...resumeMatches, ...jobMatches]
    .filter((row) => !taken.has(chunkKey(row)))
    .sort((a, b) => a.distance - b.distance);
  const remaining = Math.max(0, topK - reserved.length);

  return [...reserved, ...leftovers.slice(0, remaining)].sort((a, b) => a.distance - b.distance);
}

/**
 * Embed `query`, search resume and job chunks in parallel, then merge
 * with a per-source quota so neither side can drown the other.
 *
 * `"all"` jobs still filters to `document_type = 'job_description'` on the
 * job side, so we never pull a stray resume row from that query. The
 * resume side always uses `documentType: "resume"`.
 */
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

  return mergeWithSourceQuota(resumeMatches, jobMatches, topK).map((row) => ({
    content: row.content,
    similarity: row.similarity,
    documentType: row.documentType,
    jobId: row.jobId,
    filename: typeof row.metadata.original_filename === "string" ? row.metadata.original_filename : null,
    chunkIndex: row.chunkIndex,
  }));
}
