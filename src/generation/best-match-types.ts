import type { CareerAnalysisSource } from "@/generation/types";
import type { JobSlot } from "@/types/domain";

export const SCORE_CATEGORIES = [
  "technicalSkillAlignment",
  "experienceAlignment",
  "domainAlignment",
  "leadershipSeniorityAlignment",
] as const;

export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];

/** Each category is a 0-100 score from the LLM, judged from evidence alone. */
export type CategoryScores = Record<ScoreCategory, number>;

/**
 * What the LLM must return for one job. There is no single "score" field —
 * the model only reports per-category scores; the final weighted score is
 * always computed in application code (see scoring.ts) and never trusted
 * from the model.
 */
export type BestMatchModelOutput = {
  categoryScores: CategoryScores;
  strengths: string[];
  skillGaps: string[];
  reasoning: string;
};

export type BestMatchResult = BestMatchModelOutput & {
  jobId: string;
  jobSlot: JobSlot;
  /** Final weighted score (0-100), calculated in application code. */
  score: number;
  sources: CareerAnalysisSource[];
};
