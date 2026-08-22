/**
 * Types for retrieval evaluation. The harness calls the real
 * `retrieveCareerEvidence` function — it does not reimplement search.
 *
 * Golden cases use *logical* job ids (`job_1` … `job_4`) because UUIDs
 * are assigned at seed time. The harness translates them before comparing
 * retrieved `jobId`s. `targetJobId: "all"` means no job filter.
 */

export type EvalDocumentType = "resume" | "job_description";
export type LogicalJobId = "job_1" | "job_2" | "job_3" | "job_4";
export type LogicalTarget = LogicalJobId | "all";

/**
 * One labeled question from `evaluation/datasets/golden-questions.json`.
 *
 * - `expectedDocumentTypes` — which sources may count as relevant
 * - `expectedJobIds` — which logical jobs' JD chunks may count as relevant
 * - `expectedConcepts` — keywords that should appear in retrieved text
 */
export type GoldenCase = {
  id: string;
  question: string;
  targetJobId: LogicalTarget;
  expectedDocumentTypes: EvalDocumentType[];
  expectedJobIds: LogicalJobId[];
  expectedConcepts: string[];
};

/** Minimal retrieved-chunk shape the metric functions need. */
export type RetrievedItemForEval = {
  content: string;
  documentType: EvalDocumentType;
  jobId: string | null;
  similarity: number;
};

/**
 * Per-question scores. `jobFilterAccuracy` is null on All Jobs queries;
 * `jobCoverage` is null on specific-job queries.
 */
export type QuestionMetrics = {
  precisionAtK: number;
  recallAtK: number;
  conceptHitRate: number;
  jobFilterAccuracy: number | null;
  jobCoverage: number | null;
};

/** One question's retrieval output plus its scores, written into the report. */
export type QuestionResult = {
  id: string;
  question: string;
  targetJobId: LogicalTarget;
  topK: number;
  latencyMs: number;
  retrieved: {
    documentType: EvalDocumentType;
    jobId: string | null;
    filename: string | null;
    chunkIndex: number;
    similarity: number;
  }[];
  metrics: QuestionMetrics;
};

/** Full eval artifact written to `evaluation/results/`. */
export type EvaluationReport = {
  timestamp: string;
  datasetSize: number;
  configuration: {
    topK: number;
    embeddingModel: string;
    chunkSize: number;
    chunkOverlap: number;
  };
  perQuestion: QuestionResult[];
  aggregate: {
    precisionAtK: number;
    recallAtK: number;
    conceptHitRate: number;
    jobFilterAccuracy: number | null;
    jobCoverage: number | null;
    averageLatencyMs: number;
  };
};
