/**
 * Five assignment metrics. All scores are 0–1.
 *
 * Retrieval (labeled, no LLM):
 *   Precision@K — of the chunks we returned, how many were the right source?
 *   Recall@K    — of the relevant chunks that could fit in top-K, how many did we return?
 *
 * Generation (word overlap, easy to explain):
 *   Faithfulness       — how much of the answer appears in retrieved chunks
 *   Answer relevance   — how much of the question is covered by the answer
 *   Answer correctness — how much of the gold answer is covered by the answer
 */

import type { EvalSource } from "./types";

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "is",
  "are",
  "was",
  "were",
  "with",
  "on",
  "at",
  "by",
  "this",
  "that",
  "as",
  "be",
  "from",
  "it",
  "its",
  "their",
  "they",
  "has",
  "have",
  "had",
  "does",
  "do",
  "did",
  "what",
  "which",
  "who",
  "how",
  "should",
  "can",
  "will",
  "not",
  "no",
  "yes",
  "each",
  "any",
  "all",
]);

export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9+#.]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

/** |A ∩ B| / |A|. Empty A → 0. */
export function coverage(from: Set<string>, into: Set<string>): number {
  if (from.size === 0) return 0;
  let hits = 0;
  for (const word of from) {
    if (into.has(word)) hits += 1;
  }
  return hits / from.size;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function averageDefined(values: Array<number | null>): number | null {
  const defined = values.filter((value): value is number => value !== null);
  if (defined.length === 0) return null;
  return average(defined);
}

export function isRelevantChunk(
  item: { documentType: EvalSource; jobId: string | null },
  expectedSources: EvalSource[],
  expectedJobIds: Set<string>,
): boolean {
  if (!expectedSources.includes(item.documentType)) return false;
  if (item.documentType !== "job_description") return true;
  if (expectedJobIds.size === 0) return true;
  return item.jobId !== null && expectedJobIds.has(item.jobId);
}

/**
 * Precision@K = relevant retrieved / retrieved.
 * "Did the retriever return the right documents?"
 */
export function precisionAtK(
  retrieved: Array<{ documentType: EvalSource; jobId: string | null }>,
  expectedSources: EvalSource[],
  expectedJobIds: Set<string>,
): number {
  if (retrieved.length === 0) return 0;
  const relevant = retrieved.filter((item) => isRelevantChunk(item, expectedSources, expectedJobIds));
  return relevant.length / retrieved.length;
}

/**
 * Recall@K = relevant retrieved / min(K, relevant chunks in the corpus).
 * "Of the relevant chunks that could fit in top-K, how many did we get?"
 */
export function recallAtK(
  retrieved: Array<{ documentType: EvalSource; jobId: string | null }>,
  expectedSources: EvalSource[],
  expectedJobIds: Set<string>,
  totalRelevantAvailable: number,
  topK: number,
): number {
  const denominator = Math.min(topK, totalRelevantAvailable);
  if (denominator <= 0) return 1;
  const relevant = retrieved.filter((item) => isRelevantChunk(item, expectedSources, expectedJobIds));
  return Math.min(relevant.length / denominator, 1);
}

/**
 * Faithfulness = answer keywords found in retrieved evidence / answer keywords.
 * A made-up answer that ignores the chunks scores low.
 */
export function faithfulness(answer: string, evidenceText: string): number {
  return coverage(keywords(answer), keywords(evidenceText));
}

/**
 * Answer relevance = question keywords found in the answer / question keywords.
 * An off-topic answer scores low even if it is fluent.
 */
export function answerRelevance(question: string, answer: string): number {
  return coverage(keywords(question), keywords(answer));
}

/**
 * Answer correctness = gold-answer keywords found in the generated answer.
 * Compares the model to the written reference, not to the chunks.
 */
export function answerCorrectness(referenceAnswer: string, answer: string): number {
  return coverage(keywords(referenceAnswer), keywords(answer));
}
