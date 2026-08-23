/**
 * Evaluation types for this MVP.
 *
 * Retrieval labels use document type + job slot (not UUIDs). The runner
 * maps `job_1` / `job_2` to the IDs created when the golden PDFs are seeded.
 */

export type EvalSource = "resume" | "job_description";
export type LogicalJobId = "job_1" | "job_2";
export type EvalTarget = LogicalJobId | "all";

/** One labeled question in `evaluation/golden.json`. */
export type GoldenCase = {
  id: string;
  question: string;
  target: EvalTarget;
  /** Which sources count as relevant for Precision@K / Recall@K. */
  expectedSources: EvalSource[];
  /** Which jobs' JD chunks count as relevant. Empty = resume-only. */
  expectedJobs: LogicalJobId[];
  /** Written gold answer used for Answer Correctness. */
  referenceAnswer: string;
};

export type RetrievalMetrics = {
  precisionAtK: number;
  recallAtK: number;
};

export type GenerationMetrics = {
  faithfulness: number;
  answerRelevance: number;
  answerCorrectness: number;
};

export type QuestionResult = {
  id: string;
  question: string;
  target: EvalTarget;
  retrieved: {
    documentType: EvalSource;
    jobId: string | null;
    filename: string | null;
    chunkIndex: number;
    similarity: number;
  }[];
  generatedAnswer: string | null;
  retrieval: RetrievalMetrics;
  generation: GenerationMetrics | null;
};

export type EvaluationReport = {
  timestamp: string;
  datasetSize: number;
  topK: number;
  perQuestion: QuestionResult[];
  aggregate: {
    precisionAtK: number;
    recallAtK: number;
    faithfulness: number | null;
    answerRelevance: number | null;
    answerCorrectness: number | null;
  };
};
