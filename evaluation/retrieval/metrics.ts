import type { RetrievedItemForEval } from "./types";

/** Metric helpers for the retrieval eval harness. */

/**
 * A retrieved chunk counts as relevant to a question when its document
 * type is one the question expects, and — for job_description chunks —
 * its job id is one the question expects. An empty `expectedJobIds` means
 * the question does not restrict which job's chunks are acceptable (e.g.
 * a broad "all jobs" question with no single expected job).
 */
export function isRelevantItem(
  item: RetrievedItemForEval,
  expectedDocumentTypes: string[],
  expectedJobIds: Set<string>,
): boolean {
  if (!expectedDocumentTypes.includes(item.documentType)) {
    return false;
  }

  if (item.documentType === "job_description") {
    if (expectedJobIds.size === 0) {
      return true;
    }
    return item.jobId !== null && expectedJobIds.has(item.jobId);
  }

  return true;
}

/** Fraction of the top-K retrieved items that are relevant. */
export function precisionAtK(
  retrieved: RetrievedItemForEval[],
  expectedDocumentTypes: string[],
  expectedJobIds: Set<string>,
): number {
  if (retrieved.length === 0) {
    return 0;
  }

  const relevantCount = retrieved.filter((item) =>
    isRelevantItem(item, expectedDocumentTypes, expectedJobIds),
  ).length;

  return relevantCount / retrieved.length;
}

/**
 * Fraction of the relevant chunks that exist for this question (across the
 * whole corpus, not just the top-K) that were actually retrieved.
 * `totalRelevantAvailable` is supplied by the caller — for this evaluation
 * it is computed from the known size of the seeded golden corpus, not
 * guessed. A question with zero relevant chunks available is treated as
 * trivially satisfied (there is nothing to fail to recall).
 */
export function recallAtK(
  retrieved: RetrievedItemForEval[],
  expectedDocumentTypes: string[],
  expectedJobIds: Set<string>,
  totalRelevantAvailable: number,
): number {
  if (totalRelevantAvailable <= 0) {
    return 1;
  }

  const relevantRetrieved = retrieved.filter((item) =>
    isRelevantItem(item, expectedDocumentTypes, expectedJobIds),
  ).length;

  return Math.min(relevantRetrieved / totalRelevantAvailable, 1);
}

/**
 * Fraction of retrieved job_description chunks whose job id is one of the
 * expected jobs. This is the cross-job-contamination check: a
 * specific-job question that returns even one chunk from a different job
 * scores below 1 here, regardless of how it scores on precision/recall.
 * Resume chunks (job id null) are not job-filterable and are excluded.
 */
export function jobFilterAccuracy(
  retrieved: RetrievedItemForEval[],
  expectedJobIds: Set<string>,
): number {
  if (expectedJobIds.size === 0) {
    return 1;
  }

  const jobItems = retrieved.filter((item) => item.documentType === "job_description");
  if (jobItems.length === 0) {
    return 1;
  }

  const correct = jobItems.filter(
    (item) => item.jobId !== null && expectedJobIds.has(item.jobId),
  ).length;

  return correct / jobItems.length;
}

/**
 * Fraction of the question's expected concept keywords that appear
 * (case-insensitively) somewhere in the retrieved chunks' text. This is a
 * coarse, deterministic substring check — not semantic matching — chosen
 * specifically so it needs no LLM judge and produces the same result on
 * every run.
 */
export function conceptHitRate(
  retrieved: RetrievedItemForEval[],
  expectedConcepts: string[],
): number {
  if (expectedConcepts.length === 0) {
    return 1;
  }

  const combinedText = retrieved.map((item) => item.content.toLowerCase()).join("\n");
  const hits = expectedConcepts.filter((concept) => combinedText.includes(concept.toLowerCase()));

  return hits.length / expectedConcepts.length;
}

/**
 * For All Jobs queries: fraction of expected job IDs that appear among
 * retrieved job_description chunks (`|expected ∩ retrieved| / |expected|`).
 * Extra retrieved jobs do not lower the score — a mix is expected.
 * A question with no expected jobs is vacuously 1.
 */
export function jobCoverage(
  retrieved: RetrievedItemForEval[],
  expectedJobIds: Set<string>,
): number {
  if (expectedJobIds.size === 0) {
    return 1;
  }

  const retrievedJobIds = new Set(
    retrieved
      .filter((item) => item.documentType === "job_description" && item.jobId !== null)
      .map((item) => item.jobId as string),
  );

  let found = 0;
  for (const expectedId of expectedJobIds) {
    if (retrievedJobIds.has(expectedId)) {
      found += 1;
    }
  }

  return found / expectedJobIds.size;
}

export type LabeledMetricsInput = {
  isAllJobsQuery: boolean;
  retrieved: RetrievedItemForEval[];
  expectedDocumentTypes: string[];
  expectedJobIds: Set<string>;
  expectedConcepts: string[];
  totalRelevantAvailable: number;
};

/**
 * Applies the All Jobs vs specific-job labeling rules: jobFilterAccuracy
 * only for a selected job, jobCoverage only for All Jobs.
 */
export function computeLabeledMetrics(input: LabeledMetricsInput) {
  const {
    retrieved,
    expectedDocumentTypes,
    expectedJobIds,
    expectedConcepts,
    totalRelevantAvailable,
  } = input;

  return {
    precisionAtK: precisionAtK(retrieved, expectedDocumentTypes, expectedJobIds),
    recallAtK: recallAtK(retrieved, expectedDocumentTypes, expectedJobIds, totalRelevantAvailable),
    conceptHitRate: conceptHitRate(retrieved, expectedConcepts),
    jobFilterAccuracy: input.isAllJobsQuery ? null : jobFilterAccuracy(retrieved, expectedJobIds),
    jobCoverage: input.isAllJobsQuery ? jobCoverage(retrieved, expectedJobIds) : null,
  };
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function averageDefined(values: Array<number | null>): number | null {
  const defined = values.filter((value): value is number => value !== null);
  if (defined.length === 0) {
    return null;
  }
  return average(defined);
}
