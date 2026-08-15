import { GenerationError } from "@/generation/errors";

/** Small, shared "don't trust the model's JSON" helpers used by every
 * response parser (single-job analysis, best-match) so validation stays
 * consistent across response shapes. */

export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new GenerationError("Model response was not valid JSON", { cause: error });
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GenerationError(`Model response is missing a non-empty "${field}" string`);
  }
  return value;
}

export function requireStringArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new GenerationError(`Model response is missing a "${field}" array of strings`);
  }
  return value;
}
