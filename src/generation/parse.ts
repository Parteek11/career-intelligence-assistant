import { SCORE_CATEGORIES, type CareerAskJobAnswer, type CategoryScores } from "@/generation/types";
import { isJobSlot } from "@/types/domain";

/**
 * Strict parsers for Groq JSON.
 *
 * `response_format: json_object` only guarantees *some* JSON object. The
 * model can still omit fields, send numbers as strings, or invent extra
 * keys. These helpers fail fast with a clear error so the API returns
 * 500 instead of rendering a half-valid analysis in the UI.
 */

/** Parse a string as a plain object. Arrays and primitives are rejected. */
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

/** Require a non-empty string field. Whitespace-only counts as missing. */
function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Model response is missing a non-empty "${field}" string`);
  }
  return value;
}

/** Require an array of strings (empty array is allowed — e.g. no skill gaps). */
function requireStringArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Model response is missing a "${field}" array of strings`);
  }
  return value;
}

/**
 * Validate the Ask response shape. Extra keys from the model are ignored.
 * `jobAnswers` is optional so a single-job reply can be just `{ answer }`.
 */
export function parseAskResponse(raw: string) {
  const parsed = parseJsonObject(raw);
  const jobAnswers = parseJobAnswers(parsed.jobAnswers);
  const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
  if (!answer && jobAnswers.length === 0) {
    throw new Error('Model response is missing a non-empty "answer" or "jobAnswers"');
  }
  return { answer, jobAnswers };
}

function parseJobAnswers(value: unknown): CareerAskJobAnswer[] {
  if (!Array.isArray(value)) return [];
  const answers: CareerAskJobAnswer[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const slot = Number(record.jobSlot);
    if (!isJobSlot(slot)) continue;
    if (typeof record.answer !== "string" || record.answer.trim().length === 0) continue;
    answers.push({
      jobSlot: slot,
      filename: typeof record.filename === "string" ? record.filename.trim() || null : null,
      answer: record.answer.trim(),
    });
  }
  return answers;
}

/**
 * Validate the Analyze response shape.
 * Extra keys from the model are ignored; only the documented fields are kept.
 */
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

/**
 * Validate the Best Match response, including every category score.
 *
 * Each score must be a finite number in `[0, 100]`. We iterate
 * `SCORE_CATEGORIES` (not `Object.keys` of the model object) so a renamed
 * or missing category cannot slip through, and extra model keys are dropped.
 */
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
