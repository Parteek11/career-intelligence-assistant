import { SCORE_CATEGORIES, type CategoryScores, type ScoreCategory } from "@/generation/best-match-types";

/**
 * Initial product heuristic for how much each category should count toward
 * the final Best Match score. These weights are a starting guess about
 * what matters most for career fit — they are NOT empirically validated.
 * They should be recalibrated once evaluation data exists (e.g. recruiter
 * agreement, interview/hiring outcomes) to test candidate weightings
 * against real judgments. See README "Best match analysis".
 */
export const DEFAULT_SCORE_WEIGHTS: Record<ScoreCategory, number> = {
  technicalSkillAlignment: 0.4,
  experienceAlignment: 0.3,
  domainAlignment: 0.2,
  leadershipSeniorityAlignment: 0.1,
};

/**
 * Combines per-category LLM scores into one final score using fixed
 * weights, entirely in application code. The model is never asked for (and
 * never trusted with) a single overall number — only application code
 * decides how categories trade off, so the weighting logic stays visible,
 * testable, and changeable without touching prompts.
 *
 * Weights do not need to sum to 1; the result is normalized by their total
 * so partial or rebalanced weight sets still produce a 0-100 score.
 */
export function calculateWeightedScore(
  categoryScores: CategoryScores,
  weights: Record<ScoreCategory, number> = DEFAULT_SCORE_WEIGHTS,
): number {
  const totalWeight = SCORE_CATEGORIES.reduce((sum, category) => sum + weights[category], 0);

  if (totalWeight <= 0) {
    return 0;
  }

  const weightedSum = SCORE_CATEGORIES.reduce(
    (sum, category) => sum + categoryScores[category] * weights[category],
    0,
  );

  return Math.round((weightedSum / totalWeight) * 10) / 10;
}
