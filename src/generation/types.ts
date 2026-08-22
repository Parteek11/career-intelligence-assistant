import type { DocumentType, JobSlot } from "@/types/domain";

/**
 * Shared types for grounded generation.
 *
 * `CareerAnalysis` / `BestMatchResult` are what the API returns. `sources`
 * is always attached by the analysis service from retrieved chunks — it is
 * not a model field. `categoryScores` *is* a model field; `score` is not.
 */

/** Citation shown in the UI for one retrieved chunk. */
export type CareerAnalysisSource = {
  filename: string | null;
  documentType: DocumentType;
  jobId: string | null;
  chunkIndex: number;
  similarity: number;
};

/** Structured Analyze answer plus the chunks the model was shown. */
export type CareerAnalysis = {
  answer: string;
  strengths: string[];
  skillGaps: string[];
  experienceAlignment: string;
  interviewPreparation: string[];
  recommendations: string[];
  sources: CareerAnalysisSource[];
};

/**
 * Best Match category keys, in the order they are validated and weighted.
 * Changing this list requires updating the prompt schema and the weights.
 */
export const SCORE_CATEGORIES = [
  "technicalSkillAlignment",
  "experienceAlignment",
  "domainAlignment",
  "leadershipSeniorityAlignment",
] as const;

export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];
export type CategoryScores = Record<ScoreCategory, number>;

/** One job's Best Match result after TypeScript applies the weighted score. */
export type BestMatchResult = {
  categoryScores: CategoryScores;
  strengths: string[];
  skillGaps: string[];
  reasoning: string;
  jobId: string;
  jobSlot: JobSlot;
  score: number;
  sources: CareerAnalysisSource[];
};

/**
 * Fixed category weights. They must sum to 1.0 so the weighted average
 * stays on the same 0–100 scale as the model scores.
 *
 * Technical skill is heaviest because this assistant is aimed at
 * software-role comparisons; leadership is lightest because the golden
 * resume only mentions mentoring, not management.
 */
export const DEFAULT_SCORE_WEIGHTS: Record<ScoreCategory, number> = {
  technicalSkillAlignment: 0.4,
  experienceAlignment: 0.3,
  domainAlignment: 0.2,
  leadershipSeniorityAlignment: 0.1,
};

/**
 * Combine the four model scores into one ranking number.
 *
 * `totalWeight` is computed (not hard-coded as 1) so a future weight
 * tweak that does not sum to 1 still produces a well-defined average.
 * The result is rounded to one decimal place for stable UI display.
 */
export function calculateWeightedScore(categoryScores: CategoryScores): number {
  const totalWeight = SCORE_CATEGORIES.reduce(
    (sum, category) => sum + DEFAULT_SCORE_WEIGHTS[category],
    0,
  );
  const weightedSum = SCORE_CATEGORIES.reduce(
    (sum, category) => sum + categoryScores[category] * DEFAULT_SCORE_WEIGHTS[category],
    0,
  );
  return Math.round((weightedSum / totalWeight) * 10) / 10;
}
