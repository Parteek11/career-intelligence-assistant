/**
 * Lightweight check for fragments and keyword dumps that are not real
 * questions. Ask still runs retrieval + generation; this only decides
 * whether the user-facing answer must be the fixed invalid-question
 * message instead of a career answer.
 */

export const INVALID_QUESTION_MESSAGE = "Please type valid question";

/** Last tokens that usually mean the sentence was cut off mid-thought. */
const INCOMPLETE_ENDINGS = new Set([
  "what",
  "which",
  "how",
  "when",
  "where",
  "who",
  "why",
  "should",
  "could",
  "would",
  "the",
  "a",
  "an",
  "of",
  "for",
  "to",
  "and",
  "or",
  "my",
  "i",
  "me",
  "about",
  "with",
]);

/**
 * True when the text looks like a complete, meaningful question.
 *
 * Rejects the short / fragmentary cases called out in product:
 * "what", "what should", "skills", "what skills", "skills great",
 * "experience". Three-or-more-word asks such as "what skill missing"
 * are allowed through to the model.
 */
export function isCompleteQuestion(question: string): boolean {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length < 3) return false;
  const last = words[words.length - 1];
  return last !== undefined && !INCOMPLETE_ENDINGS.has(last);
}
