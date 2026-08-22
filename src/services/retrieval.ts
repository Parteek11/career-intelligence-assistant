import { searchSimilarChunks } from "@/db/queries";
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

/**
 * Embed `query`, search resume and job chunks in parallel, then merge.
 *
 * Why two searches instead of one unfiltered query?
 * A single search over the whole table would let a long JD drown out the
 * resume (or vice versa). Fetching `topK` from each side, then sorting by
 * cosine distance and slicing to `topK`, keeps both sources in the prompt
 * even when one corpus is much larger.
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

  // Lower `distance` = closer in embedding space. After the merge we keep
  // only the global top-K so the prompt stays a fixed size.
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
