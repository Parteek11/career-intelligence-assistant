/**
 * Types for the retrieval evaluation module. Deliberately independent of
 * `src/` — this module observes production retrieval from the outside
 * (calls the real `retrieveCareerEvidence`) rather than sharing its
 * internal types, so evaluation code cannot accidentally influence
 * production behavior.
 */

export type EvalDocumentType = "resume" | "job_description";

/** Logical job labels used in the golden dataset. Resolved to real
 * database job ids at evaluation run time, after the golden corpus is
 * seeded — the dataset itself never hardcodes a database UUID. */
export type LogicalJobId = "job_1" | "job_2" | "job_3" | "job_4";
export type LogicalTarget = LogicalJobId | "all";

export type GoldenCase = {
  id: string;
  question: string;
  targetJobId: LogicalTarget;
  expectedDocumentTypes: EvalDocumentType[];
  expectedJobIds: LogicalJobId[];
  expectedConcepts: string[];
};

/** The subset of a retrieved chunk that metric calculations need. */
export type RetrievedItemForEval = {
  content: string;
  documentType: EvalDocumentType;
  jobId: string | null;
  similarity: number;
};

export type QuestionMetrics = {
  precisionAtK: number;
  recallAtK: number;
  conceptHitRate: number;
  /**
   * Specific-job queries only: fraction of retrieved JD chunks that belong
   * to the selected job. Null for All Jobs queries — a mix of jobs is
   * expected there, so this is not a contamination check.
   */
  jobFilterAccuracy: number | null;
  /**
   * All Jobs queries only: fraction of expected job IDs that appear among
   * retrieved JD chunks. Null for specific-job queries.
   */
  jobCoverage: number | null;
};

export type RetrievedSummary = {
  documentType: EvalDocumentType;
  jobId: string | null;
  filename: string | null;
  chunkIndex: number;
  similarity: number;
};

export type QuestionResult = {
  id: string;
  question: string;
  targetJobId: LogicalTarget;
  topK: number;
  latencyMs: number;
  retrieved: RetrievedSummary[];
  metrics: QuestionMetrics;
};

export type EvaluationConfig = {
  topK: number;
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
};

export type EvaluationReport = {
  timestamp: string;
  datasetSize: number;
  configuration: EvaluationConfig;
  perQuestion: QuestionResult[];
  aggregate: {
    precisionAtK: number;
    recallAtK: number;
    conceptHitRate: number;
    /** Mean over specific-job questions only. */
    jobFilterAccuracy: number | null;
    /** Mean over All Jobs questions only. */
    jobCoverage: number | null;
    averageLatencyMs: number;
  };
};

export type ChunkingExperimentConfig = {
  chunkSize: number;
  chunkOverlap: number;
};

export type ChunkingExperimentConfigurationResult = {
  chunkSize: number;
  chunkOverlap: number;
  precisionAt5: number;
  recallAt5: number;
  conceptHitRate: number;
  averageLatencyMs: number;
};

export type ChunkingExperimentReport = {
  timestamp: string;
  datasetSize: number;
  topK: number;
  embeddingModel: string;
  configurations: ChunkingExperimentConfigurationResult[];
};
