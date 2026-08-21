import { SCORE_CATEGORIES, type CategoryScores } from "@/generation/types";

function parseJsonObject(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Model response was not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Model response was not a JSON object");
  }

  return parsed as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Model response is missing a non-empty "${field}" string`);
  }
  return value;
}

function requireStringArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Model response is missing a "${field}" array of strings`);
  }
  return value;
}

export function parseAnalysisResponse(raw: string) {
  const parsed = parseJsonObject(raw);
  return {
    answer: requireString(parsed, "answer"),
    strengths: requireStringArray(parsed, "strengths"),
    skillGaps: requireStringArray(parsed, "skillGaps"),
    experienceAlignment: requireString(parsed, "experienceAlignment"),
    interviewPreparation: requireStringArray(parsed, "interviewPreparation"),
    recommendations: requireStringArray(parsed, "recommendations"),
  };
}

export function parseBestMatchResponse(raw: string) {
  const parsed = parseJsonObject(raw);
  const scores = parsed.categoryScores;
  if (typeof scores !== "object" || scores === null || Array.isArray(scores)) {
    throw new Error('Model response is missing a "categoryScores" object');
  }

  const categoryScores = {} as CategoryScores;
  for (const category of SCORE_CATEGORIES) {
    const score = (scores as Record<string, unknown>)[category];
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error(`categoryScores.${category} must be a number between 0 and 100`);
    }
    categoryScores[category] = score;
  }

  return {
    categoryScores,
    strengths: requireStringArray(parsed, "strengths"),
    skillGaps: requireStringArray(parsed, "skillGaps"),
    reasoning: requireString(parsed, "reasoning"),
  };
}
