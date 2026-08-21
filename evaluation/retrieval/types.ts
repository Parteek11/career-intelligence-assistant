/**
 * Types for retrieval evaluation. The harness calls the real
 * `retrieveCareerEvidence` function — it does not reimplement search.
 */

export type EvalDocumentType = "resume" | "job_description";
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
  jobFilterAccuracy: number | null;
  jobCoverage: number | null;
};

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
