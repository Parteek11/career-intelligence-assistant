import { SCORE_CATEGORIES, type BestMatchModelOutput, type CategoryScores } from "@/generation/best-match-types";
import { GenerationError } from "@/generation/errors";
import {
  isRecord,
  parseJson,
  requireString,
  requireStringArray,
} from "@/generation/json-validation";

/**
 * Parses and validates the raw LLM response for a single-job best-match
 * score. Every category score is checked for presence, type, and range
 * before it can reach calculateWeightedScore — an out-of-range or missing
 * score fails loudly here instead of silently skewing the final ranking.
 */
export function parseBestMatchResponse(raw: string): BestMatchModelOutput {
  const parsed = parseJson(raw);

  if (!isRecord(parsed)) {
    throw new GenerationError("Model response was not a JSON object");
  }

  return {
    categoryScores: requireCategoryScores(parsed),
    strengths: requireStringArray(parsed, "strengths"),
    skillGaps: requireStringArray(parsed, "skillGaps"),
    reasoning: requireString(parsed, "reasoning"),
  };
}

function requireCategoryScores(record: Record<string, unknown>): CategoryScores {
  const value = record.categoryScores;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GenerationError('Model response is missing a "categoryScores" object');
  }

  const scores = value as Record<string, unknown>;
  const result = {} as CategoryScores;

  for (const category of SCORE_CATEGORIES) {
    const score = scores[category];
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
      throw new GenerationError(
        `Model response's categoryScores.${category} must be a number between 0 and 100`,
      );
    }
    result[category] = score;
  }

  return result;
}
