import { GenerationError } from "@/generation/errors";
import {
  isRecord,
  parseJson,
  requireString,
  requireStringArray,
} from "@/generation/json-validation";
import type { AnalysisModelOutput } from "@/generation/types";

/**
 * Parses and validates the raw LLM response text into the typed analysis
 * shape. The model's JSON is never trusted as-is: every required field is
 * checked for presence and type before it is used anywhere downstream.
 */
export function parseAnalysisResponse(raw: string): AnalysisModelOutput {
  const parsed = parseJson(raw);

  if (!isRecord(parsed)) {
    throw new GenerationError("Model response was not a JSON object");
  }

  return {
    answer: requireString(parsed, "answer"),
    strengths: requireStringArray(parsed, "strengths"),
    skillGaps: requireStringArray(parsed, "skillGaps"),
    experienceAlignment: requireString(parsed, "experienceAlignment"),
    interviewPreparation: requireStringArray(parsed, "interviewPreparation"),
    recommendations: requireStringArray(parsed, "recommendations"),
  };
}
